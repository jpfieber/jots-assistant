import { App, PluginSettingTab, Setting } from 'obsidian';
import JotsPlugin from './main';

export type JotsSectionFormat = 'Plain' | 'Foldable-Open' | 'Foldable-Closed';

export interface JotsSettings {
    sectionName: string;
    sectionIcon: string;
    sectionFormat: JotsSectionFormat;
    labelColor: string;
    taskLetters: string[];
    journalRootFolder: string;
    journalFolderPattern: string;
    journalFilePattern: string;
}

interface DependencyState {
    isInstalled: boolean;
    isEnabled: boolean;
}

export const DEFAULT_SETTINGS: JotsSettings = {
    sectionName: 'JOTS',
    sectionIcon: `<svg enable-background="new 0 0 512 512" version="1.1" viewBox="0 0 512 512" xml:space="preserve" xmlns="http://www.w3.org/2000/svg">
<path d="m305.93 418.92c-26.828 38.057-63.403 55.538-109.44 55.029-46.309-0.51208-92.629-0.10562-138.94-0.1196-13.622-0.004119-24.352-9.1858-25.925-22.11-1.829-15.037 6.0142-27.026 19.865-30.147 2.2417-0.50519 4.6213-0.54819 6.9375-0.5509 29.488-0.034637 58.979 0.23877 88.464-0.090301 35.371-0.39474 62.735-15.755 79.889-46.723 44.762-80.809 88.894-161.97 133.28-242.98 0.86243-1.5741 1.7962-3.1091 2.8304-4.8929 20.175 28.278 45.373 45.663 82.159 40.199-2.4802 4.5968-4.9266 9.2147-7.4479 13.791-43.214 78.443-86.436 156.88-129.66 235.32-0.56052 1.017-1.2266 1.9758-2.0111 3.2818z" fill="#000"/>
<path d="m31.481 206.92c0.12606-16.992 10.285-27.084 26.844-27.085 45.311-0.002991 90.626 0.34482 135.93-0.18555 16.216-0.18983 27.237 12.775 27.018 25.768-0.27806 16.481-10.372 27.253-27.004 27.386-19.656 0.15742-39.314 0.037079-58.971 0.037094-25.487 0-50.975 0.076645-76.462-0.027741-16.297-0.066757-26.574-9.7617-27.356-25.893z" fill="#000"/>
<path d="m45.057 61.868c4.3536-1.0541 8.3563-2.7336 12.366-2.7499 45.821-0.18574 91.644-0.13414 137.47-0.10933 15.673 0.008488 26.26 10.689 26.279 26.385 0.018921 15.985-10.543 26.596-26.562 26.602-45.322 0.016785-90.645 0.009247-135.97 0.003746-13.104-0.001594-22.883-6.7656-26.238-18.115-3.7646-12.734 0.91893-24.859 12.657-32.016z" fill="#000"/>
<path d="m124 353.17c-22.485 0-44.47 0.016082-66.455-0.005646-15.032-0.014862-25.818-10.368-26.064-24.955-0.27467-16.321 9.6991-27.874 25.236-27.956 46.3-0.24435 92.603-0.21823 138.9-0.015014 15.618 0.068542 25.762 11.459 25.549 27.635-0.19647 14.927-10.908 25.281-26.218 25.292-23.484 0.016968-46.968 0.004456-70.952 0.004456z" fill="#000"/>
<path d="m455.85 44.05c18.602 9.608 28.421 26.609 26.551 45.493-1.8979 19.171-14.44 34.297-32.867 39.638-18.386 5.3289-38.272-1.6027-49.417-17.225-11.283-15.816-11.208-37.314 0.18686-53.211 11.052-15.418 31.363-22.339 49.579-16.858 1.9016 0.5722 3.742 1.3482 5.967 2.1632z" fill="#000"/>
</svg>`,
    sectionFormat: 'Plain',
    labelColor: '#000000',
    taskLetters: ['A', 'B', 'C'],
    journalRootFolder: 'Journals',
    journalFolderPattern: 'YYYY/YYYY-MM',
    journalFilePattern: 'YYYY-MM-DD_ddd'
}

interface SettingsTab {
    id: string;
    name: string;
    content: HTMLElement;
}

export class JotsSettingTab extends PluginSettingTab {
    plugin: JotsPlugin;
    tabs: SettingsTab[] = [];
    activeTab: string = 'jots';
    private dependencyState: { [key: string]: DependencyState } = {};

    constructor(app: App, plugin: JotsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private async checkDependencies() {
        // Check if Dataview is installed and enabled
        //@ts-ignore - Access internal Obsidian API
        const dataviewPlugin = (this.app as any).plugins?.getPlugin('dataview');
        const isInstalled = dataviewPlugin !== undefined;
        //@ts-ignore - Access internal Obsidian API
        const isEnabled = isInstalled && (this.app as any).plugins?.enabledPlugins.has('dataview');

        this.dependencyState['dataview'] = {
            isInstalled,
            isEnabled
        };
    }

    private async openPluginBrowser(pluginId: string) {
        // Open community plugins browser
        //@ts-ignore - Access internal Obsidian API
        await (this.app as any).setting?.openTabById('community-plugins');
        //@ts-ignore - Access internal Obsidian API
        const communityPluginsTab = (this.app as any).setting?.activeTab;
        if (communityPluginsTab) {
            const searchEl = (communityPluginsTab.containerEl.querySelector('.search-input-container input') as HTMLInputElement);
            if (searchEl) {
                searchEl.value = pluginId;
                searchEl.dispatchEvent(new Event('input'));
            }
        }
    }

    createTab(id: string, name: string): HTMLElement {
        const content = document.createElement('div');
        content.addClass('jots-settings-content');
        if (id === this.activeTab) {
            content.addClass('is-active');
        }
        this.tabs.push({ id, name, content });
        return content;
    }

    async setActiveTab(tabId: string): Promise<void> {
        this.activeTab = tabId;

        // Remove active class from all tabs and contents
        this.tabs.forEach(tab => {
            tab.content.removeClass('is-active');
        });

        // Remove active class from all tab buttons
        const allTabButtons = this.containerEl.querySelectorAll('.jots-settings-tab');
        allTabButtons.forEach(button => button.removeClass('is-active'));

        // Add active class to selected tab and content
        const activeTab = this.tabs.find(tab => tab.id === tabId);
        if (activeTab) {
            activeTab.content.addClass('is-active');

            // Find the active button using data attribute
            const activeButton = this.containerEl.querySelector(`[data-tab-id="${tabId}"]`);
            if (activeButton) {
                activeButton.addClass('is-active');
            }

            // Clear and recreate content for the active tab
            activeTab.content.empty();
            if (tabId === 'jots') {
                await this.createJotsTab(activeTab.content);
            } else if (tabId === 'appearance') {
                this.createAppearanceSettings(activeTab.content);
            } else if (tabId === 'journal') {
                this.createJournalSettings(activeTab.content);
            }
        }
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // Create tabs container
        const tabsContainer = containerEl.createEl('div', { cls: 'jots-settings-tabs' });

        // Clear existing tabs
        this.tabs = [];

        // Create tab buttons
        const jotsTab = this.createTab('jots', 'General');
        const appearanceTab = this.createTab('appearance', 'Appearance');
        const journalTab = this.createTab('journal', 'Journals');

        // Add tab buttons with data attributes
        this.tabs.forEach(tab => {
            const tabButton = tabsContainer.createEl('div', {
                cls: `jots-settings-tab ${tab.id === this.activeTab ? 'is-active' : ''}`,
                text: tab.name
            });
            // Add data attribute for identification
            tabButton.setAttribute('data-tab-id', tab.id);
            tabButton.addEventListener('click', () => this.setActiveTab(tab.id));
        });

        // Add tabs content to container
        this.tabs.forEach(tab => {
            containerEl.appendChild(tab.content);
        });

        // Initialize the active tab
        this.setActiveTab(this.activeTab);
    }

    async createJotsTab(containerEl: HTMLElement): Promise<void> {
        await this.checkDependencies();

        containerEl.createEl('h3', { text: 'Dependencies' });

        // Create the setting with just the power button
        const settingItem = new Setting(containerEl)
            .setName('Dataview Plugin')
            .setDesc('Required for advanced JOTS features');

        const isInstalled = this.dependencyState['dataview']?.isInstalled;
        const isEnabled = this.dependencyState['dataview']?.isEnabled;
        const isActive = isInstalled && isEnabled;

        // Add power button with appropriate state
        settingItem.addExtraButton(button => {
            button
                .setIcon('power')
                .setTooltip(isActive ? 'Dataview is installed and enabled' : 'Dataview needs attention')
                .extraSettingsEl.addClass('jots-dependency-power', isActive ? 'is-active' : 'is-inactive');

            button.onClick(() => this.openPluginBrowser('dataview'));
        });
    }

    createAppearanceSettings(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            text: 'The following settings alter the appearance of the callout that will be created to hold your Jots.'
        }).addClass('setting-item-description', 'jots-settings-description');

        containerEl.createEl('hr');

        new Setting(containerEl)
            .setName('JOTS Section Name')
            .setDesc('The name of the callout/section that will contain your Jots')
            .addText(text => text
                .setPlaceholder('JOTS')
                .setValue(this.plugin.settings.sectionName)
                .onChange(async (value) => {
                    this.plugin.settings.sectionName = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Label Color')
            .setDesc('The color of the JOTS callout/section label')
            .addColorPicker(color => color
                .setValue(this.plugin.settings.labelColor)
                .onChange(async (value) => {
                    this.plugin.settings.labelColor = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('JOTS Section Icon')
            .setDesc('SVG icon data string for the callout/section (must be valid SVG XML)')
            .addTextArea(text => text
                .setPlaceholder('<svg>...</svg>')
                .setValue(this.plugin.settings.sectionIcon)
                .onChange(async (value) => {
                    this.plugin.settings.sectionIcon = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('JOTS Section Format')
            .setDesc('How the JOTS callout/section should behave')
            .addDropdown(dropdown => dropdown
                .addOption('Plain', 'Plain')
                .addOption('Foldable-Open', 'Foldable (Open by default)')
                .addOption('Foldable-Closed', 'Foldable (Closed by default)')
                .setValue(this.plugin.settings.sectionFormat)
                .onChange(async (value: JotsSectionFormat) => {
                    this.plugin.settings.sectionFormat = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Task Letters')
            .setDesc('Letters to look for in custom tasks (comma-separated, e.g. "A,B,C"). The JOTS header will only be added to notes containing tasks with these letters. Case-insensitive.')
            .addText(text => text
                .setPlaceholder('A,B,C')
                .setValue(this.plugin.settings.taskLetters.join(','))
                .onChange(async (value) => {
                    // Split by comma, trim whitespace, filter empty strings, and convert to uppercase
                    const letters = value.split(',')
                        .map(letter => letter.trim().toUpperCase())
                        .filter(letter => letter.length > 0);

                    // Validate that each entry is a single letter
                    const validLetters = letters.filter(letter => /^[A-Z]$/.test(letter));

                    // Store all letters in uppercase for consistent comparison
                    this.plugin.settings.taskLetters = validLetters;

                    // Show the normalized version (uppercase) to the user
                    if (validLetters.length !== letters.length) {
                        text.setValue(validLetters.join(','));
                    }

                    await this.plugin.saveSettings();
                }));
    }

    createJournalSettings(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            text: 'Enter the following information so we know how to find your Daily Journals. This is necessary to add the "Jots Callout" which is where your Jots will be stored.'
        }).addClass('setting-item-description', 'jots-settings-description');

        containerEl.createEl('hr');

        new Setting(containerEl)
            .setName('Journal Root Folder')
            .setDesc('The root folder where journals are stored')
            .addText(text => text
                .setPlaceholder('Journals')
                .setValue(this.plugin.settings.journalRootFolder)
                .onChange(async (value) => {
                    this.plugin.settings.journalRootFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Journal Folder Pattern')
            .setDesc('Pattern for journal folder structure (using moment.js format)')
            .addText(text => text
                .setPlaceholder('YYYY/YYYY-MM')
                .setValue(this.plugin.settings.journalFolderPattern)
                .onChange(async (value) => {
                    this.plugin.settings.journalFolderPattern = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Journal File Pattern')
            .setDesc('Pattern for journal file names (using moment.js format)')
            .addText(text => text
                .setPlaceholder('YYYY-MM-DD_ddd')
                .setValue(this.plugin.settings.journalFilePattern)
                .onChange(async (value) => {
                    this.plugin.settings.journalFilePattern = value;
                    await this.plugin.saveSettings();
                }));
    }
}