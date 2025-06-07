import { App, PluginSettingTab } from 'obsidian';
import JotsPlugin from './main';
import { SettingsTab } from './types';
import { GeneralSection } from './settings/sections/GeneralSection';
import { AppearanceSection } from './settings/sections/AppearanceSection';
import { JournalSection } from './settings/sections/JournalSection';
import { HeadersFootersSection } from './settings/sections/HeadersFootersSection';

// Re-export types that other files depend on
export type { JotsSettings, Rule, JotsSectionFormat } from './types';
// Re-export enums (these are values, not just types)
export { RuleType, RenderLocation, ContentSource } from './types';
// Re-export constants
export { DEFAULT_SETTINGS } from './constants';

export class JotsSettingTab extends PluginSettingTab {
    private tabs: SettingsTab[] = [];
    private activeTab: string = 'jots';
    private sections: {
        general: GeneralSection;
        appearance: AppearanceSection;
        journal: JournalSection;
        headersFooters: HeadersFootersSection;
    };

    constructor(app: App, private plugin: JotsPlugin) {
        super(app, plugin);

        // Initialize sections
        this.sections = {
            general: new GeneralSection(plugin, app),
            appearance: new AppearanceSection(plugin, app),
            journal: new JournalSection(plugin, app),
            headersFooters: new HeadersFootersSection(plugin, app)
        };
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

            switch (tabId) {
                case 'jots':
                    await this.sections.general.display(activeTab.content);
                    break;
                case 'appearance':
                    this.sections.appearance.display(activeTab.content);
                    break;
                case 'journal':
                    this.sections.journal.display(activeTab.content);
                    break;
                case 'headers-footers':
                    this.sections.headersFooters.display(activeTab.content);
                    break;
            }
        }
    }

    async display(): Promise<void> {
        const { containerEl } = this;
        containerEl.empty();

        // Create tabs container
        const tabsContainer = containerEl.createEl('div', { cls: 'jots-settings-tabs' });

        // Clear existing tabs
        this.tabs = [];

        // Create tab buttons
        const jotsTab = this.createTab('jots', 'General');
        const appearanceTab = this.createTab('appearance', 'Appearance');
        const headersFootersTab = this.createTab('headers-footers', 'Headers/Footers');
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
        await this.setActiveTab(this.activeTab);
    }

    /**
     * Check dependencies status. This is a public method that can be called
     * from other parts of the plugin that need to verify plugin dependencies.
     */
    async checkDependencies(): Promise<void> {
        await this.sections.general.checkDependencies();
    }
}
