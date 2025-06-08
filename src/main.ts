import {
	App,
	Notice,
	Plugin,
	MarkdownView,
	Component,
	TFile
} from 'obsidian';
import { JotsSettings, DEFAULT_SETTINGS, JotsSettingTab } from './settings';
import { registerCommands } from './commands';
import { generateJotsIconCss } from './utils';
import { PluginManager } from './plugin-manager';
import { ContentRenderer } from './core/ContentRenderer';
import { ViewEventManager } from './core/ViewEventManager';
import { RuleProcessor } from './core/RuleProcessor';

interface HTMLElementWithComponent extends HTMLElement {
	component?: Component;
}

export default class JotsPlugin extends Plugin {
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

		// Create and inject the style element for dynamic styles
		this.styleEl = document.createElement('style');
		this.styleEl.setAttribute('type', 'text/css');
		document.head.appendChild(this.styleEl);

		// Set initial dynamic styles
		this.updateStyles();

		// Check for plugin updates if enabled
		if (this.settings.updateAtStartup) {
			this.checkForUpdates();
		}

		// Register commands
		registerCommands(this);

		// Add settings tab
		this.settingTab = new JotsSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		// Register events for dynamic content
		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				if (this.settings.refreshOnFileOpen && this.initialLayoutReadyProcessed) {
					this.handleActiveViewChange();
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				if (this.initialLayoutReadyProcessed) {
					this.handleActiveViewChange();
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
	}

	onunload() {
		console.log('JOTS Assistant: Unloading Plugin...');
		// Clean up the injected styles
		if (this.styleEl && this.styleEl.parentNode) {
			this.styleEl.parentNode.removeChild(this.styleEl);
		}

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

	private async refreshAllViews(): Promise<void> {
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
		const managedPlugins = ['dataview', 'virtual-footer'];

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

	private async _processView(view: MarkdownView | null): Promise<void> {
		if (!view || !view.file) return;

		// Clean up old content
		const oldRenderer = this.contentRenderers.get(view);
		if (oldRenderer) {
			oldRenderer.cleanup();
		}

		// Get applicable rules and content
		const applicableRules = this.ruleProcessor.getApplicableRules(view.file);
		if (applicableRules.length === 0) return;

		// Create content strings
		let headerContent = "";
		let footerContent = "";

		for (const rule of applicableRules) {
			const header = this.ruleProcessor.getRuleContent(rule, 'header');
			const footer = this.ruleProcessor.getRuleContent(rule, 'footer');
			
			if (header) headerContent += header + "\n\n";
			if (footer) footerContent += footer + "\n\n";
		}

		// Create and store new renderer
		const renderer = new ContentRenderer(this, view.leaf);
		this.contentRenderers.set(view, renderer);

		// Create content elements
		const headerElement = headerContent ? await renderer.createHeaderContent(headerContent.trim()) : null;
		const footerElement = footerContent ? await renderer.createFooterContent(footerContent.trim()) : null;

		// Inject content
		renderer.injectContent(headerElement, footerElement);

		// Observe the view for changes
		this.viewManager.observeLeaf(view.leaf);
	}
}