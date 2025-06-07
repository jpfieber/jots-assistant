import {
	App,
	Notice,  // Add Notice import
	Plugin,
	MarkdownView,
	Component,
	MarkdownRenderer,
	TFile,
	getAllTags
} from 'obsidian';
import { JotsSettings, DEFAULT_SETTINGS, JotsSettingTab, Rule, RuleType, RenderLocation, ContentSource } from './settings';
import { registerCommands } from './commands';
import { generateJotsIconCss } from './utils';
import { PluginManager } from './plugin-manager';

// CSS Classes
const CSS_DYNAMIC_CONTENT_ELEMENT = 'jots-dynamic-content-element';
const CSS_HEADER_GROUP_ELEMENT = 'jots-header-group';
const CSS_FOOTER_GROUP_ELEMENT = 'jots-footer-group';
const CSS_HEADER_RENDERED_CONTENT = 'jots-header-rendered-content';
const CSS_FOOTER_RENDERED_CONTENT = 'jots-footer-rendered-content';
const CSS_CM_PADDING = 'jots-cm-padding';
const CSS_REMOVE_FLEX = 'jots-remove-flex';

// DOM Selectors
const SELECTOR_EDITOR_CONTENT_AREA = '.cm-editor .cm-content';
const SELECTOR_EDITOR_CONTENT_CONTAINER_PARENT = '.markdown-source-view.mod-cm6 .cm-contentContainer';
const SELECTOR_LIVE_PREVIEW_CONTENT_CONTAINER = '.cm-contentContainer';
const SELECTOR_EDITOR_SIZER = '.cm-sizer';
const SELECTOR_PREVIEW_HEADER_AREA = '.mod-header.mod-ui';
const SELECTOR_PREVIEW_FOOTER_AREA = '.mod-footer';

interface HTMLElementWithComponent extends HTMLElement {
	component?: Component;
}

export default class JotsPlugin extends Plugin {
	settings: JotsSettings;
	private styleEl: HTMLStyleElement;
	public pluginManager: PluginManager;
	public settingTab: JotsSettingTab;
	private pendingPreviewInjections: WeakMap<MarkdownView, { headerDiv?: HTMLElementWithComponent, footerDiv?: HTMLElementWithComponent }> = new WeakMap();
	private previewObservers: WeakMap<MarkdownView, MutationObserver> = new WeakMap();
	private initialLayoutReadyProcessed = false;

	async onload() {
		console.log('JOTS Assistant: Loading Plugin...');
		await this.loadSettings();

		// Initialize plugin manager
		this.pluginManager = new PluginManager(this);

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
		this.clearAllViewsDynamicContent();

		// Clean up any remaining DOM elements and components
		document.querySelectorAll(`.${CSS_DYNAMIC_CONTENT_ELEMENT}`).forEach(el => {
			const componentHolder = el as HTMLElementWithComponent;
			componentHolder.component?.unload();
			el.remove();
		});

		// Remove custom CSS classes
		document.querySelectorAll(`.${CSS_CM_PADDING}`).forEach(el => el.classList.remove(CSS_CM_PADDING));
		document.querySelectorAll(`.${CSS_REMOVE_FLEX}`).forEach(el => el.classList.remove(CSS_REMOVE_FLEX));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	} async saveSettings(options: { refreshViews?: boolean, refreshType?: 'all' | 'styles' | 'content' } = {}) {
		const { refreshViews = true, refreshType = 'all' } = options;
		await this.saveData(this.settings);

		if (!refreshViews) return;

		if (refreshType === 'all' || refreshType === 'styles') {
			this.updateStyles();
		}

		if (refreshType === 'all' || refreshType === 'content') {
			await this.refreshAllViews();
		}
	}

	private async refreshAllViews(): Promise<void> {
		// Process all markdown views
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
		// Get the list of installed plugins that we manage
		const app = this.app as any;
		const plugins = app.plugins;
		const pluginDir = `${app.vault.configDir}/plugins/`;
		const { adapter } = app.vault;
		const managedPlugins = ['dataview', 'virtual-footer'];

		for (const pluginId of managedPlugins) {
			const pluginPath = `${pluginDir}${pluginId}/`;

			// Skip if plugin isn't installed
			if (!await adapter.exists(pluginPath)) {
				continue;
			}

			try {
				// Get plugin repository path
				const manifest = plugins.manifests[pluginId];
				if (!manifest?.authorUrl) continue;

				const repoPath = manifest.authorUrl.replace('https://github.com/', '');

				// Check for updates but only show notice if update is found
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

		await this.removeDynamicContentFromView(view);
		const applicableRulesWithContent = await this._getApplicableRulesAndContent(view.file.path);

		if (applicableRulesWithContent.length === 0) return;

		const viewState = view.getState();
		let combinedHeaderText = "";
		let combinedFooterText = "";
		let hasFooterRule = false;
		const contentSeparator = "\n\n";

		// Combine content from all applicable rules
		for (const { rule, contentText } of applicableRulesWithContent) {
			if (!contentText || contentText.trim() === "") continue;

			if (rule.renderLocation === RenderLocation.Header) {
				combinedHeaderText += (combinedHeaderText ? contentSeparator : "") + contentText;
			} else {
				combinedFooterText += (combinedFooterText ? contentSeparator : "") + contentText;
				hasFooterRule = true;
			}
		}

		if (viewState.mode === 'source' && !viewState.source && hasFooterRule) {
			this.applyLivePreviewFooterStyles(view);
		}

		let pendingHeaderDiv: HTMLElementWithComponent | null = null;
		let pendingFooterDiv: HTMLElementWithComponent | null = null;

		// Render and inject content based on view mode
		if (viewState.mode === 'preview' || (viewState.mode === 'source' && !viewState.source)) {
			if (combinedHeaderText.trim()) {
				const result = await this.renderAndInjectGroupedContent(view, combinedHeaderText, RenderLocation.Header);
				if (result && viewState.mode === 'preview') {
					pendingHeaderDiv = result;
				}
			}
			if (combinedFooterText.trim()) {
				const result = await this.renderAndInjectGroupedContent(view, combinedFooterText, RenderLocation.Footer);
				if (result && viewState.mode === 'preview') {
					pendingFooterDiv = result;
				}
			}
		}

		// Set up observer for pending injections
		if (pendingHeaderDiv || pendingFooterDiv) {
			let pending = this.pendingPreviewInjections.get(view);
			if (!pending) {
				pending = {};
				this.pendingPreviewInjections.set(view, pending);
			}
			if (pendingHeaderDiv) pending.headerDiv = pendingHeaderDiv;
			if (pendingFooterDiv) pending.footerDiv = pendingFooterDiv;
			this.ensurePreviewObserver(view);
		}
	}

	private async clearAllViewsDynamicContent(): Promise<void> {
		this.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
			if (leaf.view instanceof MarkdownView) {
				this.removeDynamicContentFromView(leaf.view);
			}
		});
	}

	private ensurePreviewObserver(view: MarkdownView): void {
		if (this.previewObservers.has(view) || !view.file || !view.previewMode?.containerEl) {
			return;
		}

		const observer = new MutationObserver((_mutations) => {
			if (!view.file) {
				observer.disconnect();
				this.previewObservers.delete(view);
				const pendingStale = this.pendingPreviewInjections.get(view);
				if (pendingStale) {
					pendingStale.headerDiv?.component?.unload();
					pendingStale.footerDiv?.component?.unload();
					this.pendingPreviewInjections.delete(view);
				}
				return;
			}

			const pending = this.pendingPreviewInjections.get(view);
			if (!pending || (!pending.headerDiv && !pending.footerDiv)) {
				observer.disconnect();
				this.previewObservers.delete(view);
				if (pending) this.pendingPreviewInjections.delete(view);
				return;
			}

			let allResolved = true;
			const sourcePath = view.file.path;

			if (pending.headerDiv) {
				const headerTargetParent = view.previewMode.containerEl.querySelector<HTMLElement>(SELECTOR_PREVIEW_HEADER_AREA);
				if (headerTargetParent) {
					headerTargetParent.appendChild(pending.headerDiv);
					if (pending.headerDiv.component) {
						this.attachInternalLinkHandlers(pending.headerDiv, sourcePath, pending.headerDiv.component);
					}
					delete pending.headerDiv;
				} else {
					allResolved = false;
				}
			}

			if (pending.footerDiv) {
				const footerTargetParent = view.previewMode.containerEl.querySelector<HTMLElement>(SELECTOR_PREVIEW_FOOTER_AREA);
				if (footerTargetParent) {
					footerTargetParent.appendChild(pending.footerDiv);
					if (pending.footerDiv.component) {
						this.attachInternalLinkHandlers(pending.footerDiv, sourcePath, pending.footerDiv.component);
					}
					delete pending.footerDiv;
				} else {
					allResolved = false;
				}
			}

			if (allResolved) {
				observer.disconnect();
				this.previewObservers.delete(view);
				this.pendingPreviewInjections.delete(view);
			}
		});

		observer.observe(view.previewMode.containerEl, { childList: true, subtree: true });
		this.previewObservers.set(view, observer);
	}
	private attachInternalLinkHandlers(element: HTMLElement, sourcePath: string, component: Component): void {
		// Create a mutation observer to watch for dynamically added links (e.g., from DataviewJS)
		const observer = new MutationObserver((mutations) => {
			mutations.forEach(mutation => {
				if (mutation.type === 'childList') {
					mutation.addedNodes.forEach(node => {
						if (node instanceof HTMLElement) {
							this.processLinks(node, sourcePath, component);
						}
					});
				}
			});
		});

		// Start observing the element for any changes in the DOM
		observer.observe(element, {
			childList: true,
			subtree: true
		});

		// Store the observer in the component for cleanup
		component.register(() => observer.disconnect());

		// Process any existing links
		this.processLinks(element, sourcePath, component);
	}

	private processLinks(element: HTMLElement, sourcePath: string, component: Component): void {
		// Handle all links in the rendered content
		element.querySelectorAll('a').forEach(link => {
			// Skip if we've already processed this link
			if (link.hasAttribute('data-jots-processed')) return;

			const href = link.getAttribute('href');

			// Skip external links (those starting with http:// or https://)
			if (href?.match(/^https?:\/\//)) {
				link.setAttribute('data-jots-processed', 'true');
				return;
			}

			// For all other links, treat them as internal
			component.registerDomEvent(link, 'click', (evt: MouseEvent) => {
				evt.preventDefault();
				if (href) {
					this.app.workspace.openLinkText(href, sourcePath, evt.ctrlKey || evt.metaKey);
				}
			});

			// Mark the link as processed
			link.setAttribute('data-jots-processed', 'true');
		});
	}

	private applyLivePreviewFooterStyles(view: MarkdownView): void {
		const contentEl = view.containerEl.querySelector<HTMLDivElement>(SELECTOR_EDITOR_CONTENT_AREA);
		const containerEl = view.containerEl.querySelector<HTMLDivElement>(SELECTOR_EDITOR_CONTENT_CONTAINER_PARENT);
		contentEl?.classList.add(CSS_CM_PADDING);
		containerEl?.classList.add(CSS_REMOVE_FLEX);
	}

	private removeLivePreviewFooterStyles(viewOrContainer: MarkdownView | HTMLElement): void {
		const container = viewOrContainer instanceof MarkdownView ? viewOrContainer.containerEl : viewOrContainer;
		const contentEl = container.querySelector<HTMLDivElement>(SELECTOR_EDITOR_CONTENT_AREA);
		const containerEl = container.querySelector<HTMLDivElement>(SELECTOR_EDITOR_CONTENT_CONTAINER_PARENT);
		contentEl?.classList.remove(CSS_CM_PADDING);
		containerEl?.classList.remove(CSS_REMOVE_FLEX);
	}

	private async removeDynamicContentFromView(view: MarkdownView): Promise<void> {
		this.removeLivePreviewFooterStyles(view);
		await this.removeInjectedContentDOM(view.containerEl);

		const observer = this.previewObservers.get(view);
		if (observer) {
			observer.disconnect();
			this.previewObservers.delete(view);
		}

		const pending = this.pendingPreviewInjections.get(view);
		if (pending) {
			pending.headerDiv?.component?.unload();
			pending.footerDiv?.component?.unload();
			this.pendingPreviewInjections.delete(view);
		}
	}

	private async removeInjectedContentDOM(containerEl: HTMLElement): Promise<void> {
		containerEl.querySelectorAll(`.${CSS_DYNAMIC_CONTENT_ELEMENT}`).forEach(el => {
			const componentHolder = el as HTMLElementWithComponent;
			if (componentHolder.component) {
				componentHolder.component.unload();
			}
			el.remove();
		});
	}

	private async renderAndInjectGroupedContent(
		view: MarkdownView,
		combinedContentText: string,
		renderLocation: RenderLocation
	): Promise<HTMLElementWithComponent | null> {
		if (!combinedContentText || combinedContentText.trim() === "") {
			return null;
		}

		const isRenderInHeader = renderLocation === RenderLocation.Header;
		const sourcePath = view.file?.path || '';

		const groupDiv = document.createElement('div') as HTMLElementWithComponent;
		groupDiv.className = CSS_DYNAMIC_CONTENT_ELEMENT;
		groupDiv.classList.add(
			isRenderInHeader ? CSS_HEADER_GROUP_ELEMENT : CSS_FOOTER_GROUP_ELEMENT,
			isRenderInHeader ? CSS_HEADER_RENDERED_CONTENT : CSS_FOOTER_RENDERED_CONTENT
		);

		const component = new Component();
		component.load();
		groupDiv.component = component;

		await MarkdownRenderer.render(this.app, combinedContentText, groupDiv, sourcePath, component);

		let injectionSuccessful = false;
		const viewState = view.getState();

		if (viewState.mode === 'preview') {
			const previewContentParent = view.previewMode.containerEl;
			const targetParent = previewContentParent.querySelector<HTMLElement>(
				isRenderInHeader ? SELECTOR_PREVIEW_HEADER_AREA : SELECTOR_PREVIEW_FOOTER_AREA
			);
			if (targetParent) {
				targetParent.appendChild(groupDiv);
				injectionSuccessful = true;
			}
		} else if (viewState.mode === 'source' && !viewState.source) {
			if (isRenderInHeader) {
				const cmContentContainer = view.containerEl.querySelector<HTMLElement>(SELECTOR_LIVE_PREVIEW_CONTENT_CONTAINER);
				if (cmContentContainer?.parentElement) {
					cmContentContainer.parentElement.insertBefore(groupDiv, cmContentContainer);
					injectionSuccessful = true;
				}
			} else {
				const targetParent = view.containerEl.querySelector<HTMLElement>(SELECTOR_EDITOR_SIZER);
				if (targetParent) {
					targetParent.appendChild(groupDiv);
					injectionSuccessful = true;
				}
			}
		}

		if (injectionSuccessful) {
			this.attachInternalLinkHandlers(groupDiv, sourcePath, component);
			return null;
		} else {
			if (viewState.mode === 'preview') {
				console.log(`JOTS: Deferring injection for ${renderLocation} in preview mode. Target not found yet.`);
				return groupDiv;
			} else {
				component.unload();
				console.warn(`JOTS: Failed to find injection point for dynamic content group (${renderLocation}). View mode: ${viewState.mode}.`);
				return null;
			}
		}
	}

	private async _getApplicableRulesAndContent(filePath: string): Promise<Array<{ rule: Rule; contentText: string }>> {
		const allApplicable: Array<{ rule: Rule; contentText: string }> = [];
		const abstractFile = this.app.vault.getAbstractFileByPath(filePath);

		if (!(abstractFile instanceof TFile)) {
			return [];
		}

		const file: TFile = abstractFile;
		let fileTags: string[] | null = null;
		const fileCache = this.app.metadataCache.getFileCache(file);
		const hasEnabledTagRule = this.settings.rules.some((r: Rule) => r.enabled && r.type === RuleType.Tag);
		if (hasEnabledTagRule && fileCache) {
			const allTagsInFileWithHash = getAllTags(fileCache);
			fileTags = allTagsInFileWithHash ? allTagsInFileWithHash.map(tag => tag.substring(1)) : [];
		}

		for (const rule of this.settings.rules) {
			if (!rule.enabled) continue;

			let isMatch = false;
			const ruleRecursive = rule.recursive === undefined ? true : rule.recursive;

			switch (rule.type) {
				case RuleType.Folder:
					if (rule.path === "") {
						isMatch = true; // Match all files
					} else if (rule.path === "/") {
						isMatch = ruleRecursive || file.parent?.path === "/";
					} else {
						const rulePath = rule.path || "";
						const normalizedRulePath = rulePath.endsWith("/") ? rulePath : rulePath + "/";
						const normalizedFilePath = (file.parent?.path || "") + "/";
						if (ruleRecursive) {
							isMatch = normalizedFilePath.startsWith(normalizedRulePath);
						} else {
							isMatch = normalizedFilePath === normalizedRulePath;
						}
					}
					break;

				case RuleType.Tag:
					if (rule.tag && fileTags) {
						if (rule.includeSubtags) {
							isMatch = fileTags.some(tag => tag === rule.tag || tag.startsWith(rule.tag + "/"));
						} else {
							isMatch = fileTags.includes(rule.tag);
						}
					}
					break;

				case RuleType.Property:
					if (rule.propertyName && fileCache?.frontmatter) {
						const value = fileCache.frontmatter[rule.propertyName];
						if (rule.propertyValue) {
							if (Array.isArray(value)) {
								isMatch = value.includes(rule.propertyValue);
							} else {
								isMatch = value === rule.propertyValue;
							}
						} else {
							isMatch = value !== undefined && value !== null;
						}
					}
					break;
			}			if (isMatch) {
				let contentText: string; if (rule.contentSource === ContentSource.Text) {
					contentText = rule.footerText;
				} else {
					const contentFile = rule.footerFilePath ?
						this.app.vault.getAbstractFileByPath(rule.footerFilePath) : null;
					if (contentFile instanceof TFile) {
						contentText = await this.app.vault.read(contentFile);
					} else {
						contentText = '';
					}
				}

				if (contentText.trim()) {
					allApplicable.push({ rule, contentText });
				}
			}
		}

		return allApplicable;
	}
}