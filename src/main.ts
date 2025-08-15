import {
	App,
	Notice,
	Plugin,
	MarkdownView,
	Component,
	TFile,
	WorkspaceLeaf
} from 'obsidian';
import { JotsSettings, DEFAULT_SETTINGS, JotsSettingTab } from './settings';
import { registerCommands } from './commands';
import { generateJotsIconCss } from './utils';
import { PluginManager } from './plugin-manager';
import { ContentRenderer } from './core/ContentRenderer';
import { ViewEventManager } from './core/ViewEventManager';
import { RuleProcessor } from './core/RuleProcessor';
import { JotsApi } from './api/JotsApi';

interface HTMLElementWithComponent extends HTMLElement {
	component?: Component;
}

/**
 * The global namespace for the JOTS Assistant plugin API
 */
declare global {
	interface Window {
		JotsAssistant?: {
			api: JotsApi;
		};
	}
}

export default class JotsPlugin extends Plugin {
	api: JotsApi;
	settings: JotsSettings;
	private styleEl: HTMLStyleElement;
	private ruleProcessor: RuleProcessor;
	private viewManager: ViewEventManager;
	public pluginManager: PluginManager;
	public settingTab: JotsSettingTab;
	private pendingPreviewInjections: WeakMap<MarkdownView, { headerDiv?: HTMLElementWithComponent, footerDiv?: HTMLElementWithComponent }> = new WeakMap();
	private contentRenderers: WeakMap<MarkdownView, ContentRenderer> = new WeakMap();
	private initialLayoutReadyProcessed = false;

	async onload() {
		console.log('JOTS Assistant: Loading Plugin...');
		await this.loadSettings();

		// Initialize managers and processors
		this.pluginManager = new PluginManager(this);
		this.ruleProcessor = new RuleProcessor(this.settings);
		this.viewManager = new ViewEventManager();
		// Initialize and expose the API
		this.api = new JotsApi(this);
		console.debug('JOTS Assistant: Initializing API', this.api);
		window.JotsAssistant = {
			api: this.api
		};
		console.debug('JOTS Assistant: API exposed on window object:', {
			api: window.JotsAssistant?.api,
			fullObject: window.JotsAssistant
		});

		// Create and inject the style element for dynamic styles
		this.styleEl = document.createElement('style');
		this.styleEl.setAttribute('type', 'text/css');
		document.head.appendChild(this.styleEl);

		// Set initial dynamic styles
		this.updateStyles();

		// Check for plugin updates if enabled
		if (this.settings.updateAtStartup) {
			this.checkForUpdates();
		}		// Register commands
		registerCommands(this);

		// Add settings tab
		this.settingTab = new JotsSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);		// Track current file for each leaf to detect actual file changes
		const leafFiles = new WeakMap<WorkspaceLeaf, string>();
		let lastActiveLeaf: WorkspaceLeaf | null = null;

		// Register event to refresh headers/footers when a file is opened or a tab's content changes
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view || !file) return;

				const leaf = view.leaf;
				const currentFilePath = file.path;
				const previousFilePath = leafFiles.get(leaf);

				// Check if we've switched to a different leaf (tab switch) or different file
				const isTabSwitch = lastActiveLeaf && lastActiveLeaf !== leaf;
				const isFileChange = currentFilePath !== previousFilePath;

				// Process the view if it's a tab switch or file change
				if (isTabSwitch || isFileChange) {
					// Clean up old renderer if it exists
					const oldRenderer = this.contentRenderers.get(view);
					if (oldRenderer) {
						oldRenderer.cleanup();
						this.contentRenderers.delete(view);
					}
					this.handleActiveViewChange();

					// Update tracked file for this leaf
					leafFiles.set(leaf, currentFilePath);
				}

				// Update the last active leaf
				lastActiveLeaf = leaf;
			})
		);
		// Register event for tab switching (more reliable for detecting when user switches between tabs)
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (!leaf || !(leaf.view instanceof MarkdownView)) return;

				// Only process if we're switching to a different leaf
				if (lastActiveLeaf !== leaf) {
					const view = leaf.view;
					if (view && view.file) {
						console.debug('JOTS Assistant: Active leaf changed to:', view.file.path);

						// Clean up old renderer if it exists
						const oldRenderer = this.contentRenderers.get(view);
						if (oldRenderer) {
							oldRenderer.cleanup();
							this.contentRenderers.delete(view);
						}

						// Process the view with multiple strategies to ensure it works
						const processView = () => {
							this.handleActiveViewChange();
						};

						// Try immediate processing
						processView();

						// Also try with a small delay in case DOM isn't ready
						setTimeout(processView, 50);

						// Update tracked file for this leaf
						leafFiles.set(leaf, view.file.path);
					}
					lastActiveLeaf = leaf;
				}
			})
		);
		// Process initial view once layout is ready
		this.app.workspace.onLayoutReady(() => {
			if (!this.initialLayoutReadyProcessed) {
				this.handleActiveViewChange();
				this.initialLayoutReadyProcessed = true;
			}
		});

		// Handle mode changes (edit/preview) in markdown views
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView) {
					// Small delay to ensure the mode change is complete
					setTimeout(() => {
						console.debug('JOTS Assistant: Layout changed, reprocessing view');
						this.handleActiveViewChange();
					}, 100);
				}
			})
		);
	}
	onunload() {
		console.log('JOTS Assistant: Unloading Plugin...');
		// Clean up the injected styles
		if (this.styleEl && this.styleEl.parentNode) {
			this.styleEl.parentNode.removeChild(this.styleEl);
		}

		// Clean up API
		delete window.JotsAssistant;

		// Clean up view manager
		this.viewManager.cleanup();

		// Clean up content renderers
		this.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
			if (leaf.view instanceof MarkdownView) {
				const renderer = this.contentRenderers.get(leaf.view);
				if (renderer) {
					renderer.cleanup();
					this.contentRenderers.delete(leaf.view);
				}
			}
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		
		// Migration: Remove old per-event taskLetter and emoji fields
		if (this.settings.events) {
			this.settings.events = this.settings.events.map(event => {
				const cleanEvent = { ...event };
				// Remove deprecated fields
				delete (cleanEvent as any).taskLetter;
				delete (cleanEvent as any).emoji;
				return cleanEvent;
			});
		}
		
		// Migration: Ensure global event settings exist
		if (!this.settings.eventTaskLetter) {
			this.settings.eventTaskLetter = 'e';
		}
		if (!this.settings.eventEmoji) {
			this.settings.eventEmoji = '🎈';
		}
		
		this.ruleProcessor = new RuleProcessor(this.settings);
		this.viewManager = new ViewEventManager();
	}

	async saveSettings(options: { refreshViews?: boolean, refreshType?: 'all' | 'styles' | 'content' } = {}) {
		const { refreshViews = true, refreshType = 'all' } = options;
		await this.saveData(this.settings);

		// Update rule processor with new settings
		this.ruleProcessor = new RuleProcessor(this.settings);

		if (!refreshViews) return;

		if (refreshType === 'all' || refreshType === 'styles') {
			this.updateStyles();
		}

		if (refreshType === 'all' || refreshType === 'content') {
			await this.refreshAllViews();
		}
	}
	async refreshAllViews(): Promise<void> {
		this.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
			if (leaf.view instanceof MarkdownView) {
				this._processView(leaf.view);
			}
		});
	}

	private updateStyles() {
		const iconWithColor = this.settings.sectionIcon.replace('"black"', `"${this.settings.labelColor}"`);
		this.styleEl.textContent = generateJotsIconCss(this.settings.sectionName, iconWithColor, this.settings.labelColor);
	}

	async checkForUpdates() {
		const app = this.app as any;
		const plugins = app.plugins;
		const pluginDir = `${app.vault.configDir}/plugins/`;
		const { adapter } = app.vault;
		const managedPlugins = ['dataview', 'virtual-footer', 'jots-body-tracker'];

		for (const pluginId of managedPlugins) {
			const pluginPath = `${pluginDir}${pluginId}/`;
			if (!await adapter.exists(pluginPath)) continue;

			try {
				const manifest = plugins.manifests[pluginId];
				if (!manifest?.authorUrl) continue;

				const repoPath = manifest.authorUrl.replace('https://github.com/', '');
				const result = await this.pluginManager.addPlugin(repoPath);
				if (result) {
					new Notice(`Plugin ${manifest.name} has been updated to the latest version`);
				}
			} catch (error) {
				console.error(`Error checking updates for ${pluginId}:`, error);
			}
		}
	}

	private handleActiveViewChange = () => {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		this._processView(activeView);
	}

	/**
	 * Force reprocessing of the current active view, useful for debugging or ensuring content is displayed
	 */
	public refreshCurrentView(): void {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			// Clean up existing renderer completely
			const oldRenderer = this.contentRenderers.get(activeView);
			if (oldRenderer) {
				oldRenderer.cleanup();
				this.contentRenderers.delete(activeView);
			}

			// Force reprocessing
			this._processView(activeView);
		}
	}
	private async _processView(view: MarkdownView | null): Promise<void> {
		if (!view || !view.file) return;

		console.debug('JOTS Assistant: Processing view for file:', view.file.path);

		// Clean up old content
		const oldRenderer = this.contentRenderers.get(view);
		if (oldRenderer) {
			console.debug('JOTS Assistant: Cleaning up old renderer');
			oldRenderer.cleanup();
		}

		// Get applicable rules and content
		const applicableRules = this.ruleProcessor.getApplicableRules(view.file);
		console.debug('JOTS Assistant: Found applicable rules:', applicableRules.length);

		if (applicableRules.length === 0) {
			// Clean up any existing renderer if no rules apply
			this.contentRenderers.delete(view);
			return;
		}

		// Create content strings
		let headerContent = "";
		let footerContent = "";

		for (const rule of applicableRules) {
			const header = this.ruleProcessor.getRuleContent(rule, 'header');
			const footer = this.ruleProcessor.getRuleContent(rule, 'footer');

			if (header) headerContent += header + "\n\n";
			if (footer) footerContent += footer + "\n\n";
		}

		console.debug('JOTS Assistant: Content generated - Header:', !!headerContent, 'Footer:', !!footerContent);

		// Create and store new renderer
		const renderer = new ContentRenderer(this, view.leaf);
		this.contentRenderers.set(view, renderer);

		// Create content elements
		const headerElement = headerContent ? await renderer.createHeaderContent(headerContent.trim()) : null;
		const footerElement = footerContent ? await renderer.createFooterContent(footerContent.trim()) : null;

		// Try multiple strategies to inject content to handle timing issues
		const tryInjectContent = (attempt: number = 1) => {
			console.debug(`JOTS Assistant: Injecting content (attempt ${attempt})`);
			try {
				renderer.injectContent(headerElement, footerElement);
			} catch (error) {
				console.error('JOTS Assistant: Error injecting content:', error);
				if (attempt < 3) {
					setTimeout(() => tryInjectContent(attempt + 1), 100 * attempt);
				}
			}
		};

		// Try immediate injection first
		requestAnimationFrame(() => tryInjectContent());

		// Observe the view for changes
		this.viewManager.observeLeaf(view.leaf);
	}
}