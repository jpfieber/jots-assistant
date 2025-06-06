import { Plugin } from 'obsidian';
import { JotsSettings, DEFAULT_SETTINGS, JotsSettingTab } from './settings';
import { registerCommands } from './commands';
import { generateJotsIconCss } from './utils';
import { PluginManager } from './plugin-manager';

export default class JotsPlugin extends Plugin {
	settings: JotsSettings;
	private styleEl: HTMLStyleElement;
	public pluginManager: PluginManager;
	public settingTab: JotsSettingTab;

	async onload() {
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
	}

	onunload() {
		// Clean up the injected styles
		if (this.styleEl && this.styleEl.parentNode) {
			this.styleEl.parentNode.removeChild(this.styleEl);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.updateStyles();
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

				// Check for and apply updates
				await this.pluginManager.addPlugin(repoPath);
			} catch (error) {
				console.error(`Error checking updates for ${pluginId}:`, error);
			}
		}
	}
}