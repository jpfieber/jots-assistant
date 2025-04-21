import { Plugin } from 'obsidian';
import { JotsSettings, DEFAULT_SETTINGS, JotsSettingTab } from './settings';
import { registerCommands } from './commands';
import { generateJotsIconCss } from './utils';

export default class JotsPlugin extends Plugin {
	settings: JotsSettings;
	private styleEl: HTMLStyleElement;

	async onload() {
		await this.loadSettings();

		// Create and inject the style element
		this.styleEl = document.createElement('style');
		this.styleEl.setAttribute('type', 'text/css');
		document.head.appendChild(this.styleEl);

		// Set initial styles
		this.updateStyles();

		// Register commands
		registerCommands(this);

		// Add settings tab
		this.addSettingTab(new JotsSettingTab(this.app, this));
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
		if (this.styleEl) {
			const css = generateJotsIconCss(
				this.settings.sectionName,
				this.settings.sectionIcon,
				this.settings.labelColor
			);
			this.styleEl.textContent = css;
		}
	}
}