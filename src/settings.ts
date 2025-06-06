import { AbstractInputSuggest, App, PluginSettingTab, Setting, MarkdownView, ButtonComponent, getAllTags } from 'obsidian';
import JotsPlugin from './main';

export type JotsSectionFormat = 'Plain' | 'Foldable-Open' | 'Foldable-Closed';

interface InternalPlugins {
    manifests: { [key: string]: any };
    plugins: { [key: string]: any };
    enablePluginAndSave: (id: string) => Promise<void>;
    disablePluginAndSave: (id: string) => Promise<void>;
}

interface ExtendedApp extends App {
    plugins: InternalPlugins;
}

interface DependencyState {
    isInstalled: boolean;
    isEnabled: boolean;
}

interface JotsPluginInfo {
    repo: string;
    name: string;
    description: string;
}

const JOTS_PLUGINS: JotsPluginInfo[] = [
    {
        repo: 'jpfieber/jots-inbox-processor',
        name: 'Inbox Processor',
        description: 'JOTS plugin to process inbox items'
    },
    {
        repo: 'jpfieber/jots-yesterdays-weather',
        name: "Yesterday's Weather",
        description: 'JOTS plugin to display weather information'
    }
];

export interface JotsSettings {
    sectionName: string;
    sectionIcon: string;
    sectionFormat: JotsSectionFormat;
    labelColor: string;
    taskLetters: string[];
    journalRootFolder: string;
    journalFolderPattern: string;
    journalFilePattern: string;
    personalAccessToken?: string; // GitHub personal access token for rate limits
    updateAtStartup: boolean; // Whether to auto-update plugins at startup
    rules: Rule[]; // Virtual Footer rules
    refreshOnFileOpen?: boolean; // Whether to refresh headers/footers on file open
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
    } async checkDependencies() {
        // Helper function to check plugin state
        const checkPlugin = async (id: string) => {
            const app = this.app as unknown as ExtendedApp;
            const pluginDir = `${app.vault.configDir}/plugins/${id}/`;
            const { adapter } = app.vault;

            // Check if plugin folder exists
            const isInstalled = await adapter.exists(pluginDir);

            // Check if plugin is both installed and enabled
            const isEnabled = isInstalled && app.plugins.plugins[id] !== undefined;

            this.dependencyState[id] = {
                isInstalled,
                isEnabled
            };
        };

        // Check both required plugins
        await checkPlugin('dataview');
        await checkPlugin('virtual-footer');

        // Check JOTS plugins
        for (const plugin of JOTS_PLUGINS) {
            const id = plugin.repo.split('/')[1]; // Get plugin ID from repo
            await checkPlugin(id);
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
            } else if (tabId === 'headers-footers') {
                this.createHeadersFootersSettings(activeTab.content);
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

    async createJotsTab(containerEl: HTMLElement): Promise<void> {
        await this.checkDependencies();

        containerEl.createEl('h3', { text: 'Plugin Dependencies' });

        // Auto-update setting
        new Setting(containerEl)
            .setName('Auto-update plugins at startup')
            .setDesc('If enabled, installed plugins will be checked for updates each time Obsidian starts')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.updateAtStartup)
                .onChange(async (value) => {
                    this.plugin.settings.updateAtStartup = value;
                    await this.plugin.saveSettings({ refreshViews: false });
                }));

        containerEl.createEl('hr');

        // Add description for required plugins
        containerEl.createEl('p', {
            text: 'These plugins are required for JOTS to function properly.'
        }).addClass('setting-item-description');

        // Helper function to create dependency controls
        const createDependencyControls = async (
            name: string,
            desc: string,
            id: string,
            repo: string
        ) => {
            const setting = new Setting(containerEl)
                .setName(name)
                .setDesc(desc);

            const isInstalled = this.dependencyState[id]?.isInstalled;
            //@ts-ignore - Access internal Obsidian API
            const isLoaded = this.app.plugins?.plugins[id] !== undefined;
            const isEnabled = isInstalled && isLoaded;

            // Create the main action button (Install/Uninstall)
            setting.addButton(btn => {
                if (!isInstalled) {
                    btn.setButtonText('Install')
                        .setCta()
                        .onClick(async () => {
                            btn.setButtonText('Installing...');
                            btn.setDisabled(true);
                            const success = await this.plugin.pluginManager.addPlugin(repo);
                            await this.checkDependencies();
                            const state = this.dependencyState[id];

                            if (success && state?.isInstalled) {
                                btn.setButtonText('Uninstall')
                                    .removeCta()
                                    .setDisabled(state.isEnabled);

                                // Add toggle since plugin is now installed
                                setting.addToggle(toggle => {
                                    toggle.setValue(state.isEnabled)
                                        .setTooltip(state.isEnabled ? `Disable ${name}` : `Enable ${name}`)
                                        .onChange(async (value) => {
                                            //@ts-ignore - Access internal Obsidian API
                                            if (value) await this.app.plugins.enablePluginAndSave(id);
                                            //@ts-ignore - Access internal Obsidian API
                                            else await this.app.plugins.disablePluginAndSave(id);
                                            await this.checkDependencies();
                                            const newState = this.dependencyState[id];
                                            btn.setDisabled(newState?.isEnabled ?? false);
                                        });
                                });
                            } else {
                                btn.setButtonText('Install')
                                    .setCta()
                                    .setDisabled(false);
                            }
                        });
                } else {
                    btn.setButtonText('Uninstall')
                        .setDisabled(isEnabled)
                        .onClick(async () => {
                            btn.setButtonText('Uninstalling...');
                            btn.setDisabled(true);
                            await this.plugin.pluginManager.uninstallPlugin(id);
                            await this.checkDependencies();
                            const state = this.dependencyState[id];

                            if (!state?.isInstalled) {
                                btn.setButtonText('Install')
                                    .setCta()
                                    .setDisabled(false);

                                // Remove the toggle since plugin is now uninstalled
                                setting.components = setting.components.filter(c => c instanceof ButtonComponent);
                            }
                        });

                    // Add toggle for installed plugins
                    setting.addToggle(toggle => {
                        toggle.setValue(isEnabled)
                            .setTooltip(isEnabled ? `Disable ${name}` : `Enable ${name}`)
                            .onChange(async (value) => {
                                //@ts-ignore - Access internal Obsidian API
                                if (value) await this.app.plugins.enablePluginAndSave(id);
                                //@ts-ignore - Access internal Obsidian API
                                else await this.app.plugins.disablePluginAndSave(id);
                                await this.checkDependencies();
                                const state = this.dependencyState[id];
                                btn.setDisabled(state?.isEnabled ?? false);
                            });
                    });
                }
            });
        };

        // Create controls for each required dependency
        await createDependencyControls(
            'Dataview',
            'Required for advanced JOTS features',
            'dataview',
            'blacksmithgu/obsidian-dataview'
        ); await createDependencyControls(
            'Virtual Footer',
            'Required for JOTS footer integration',
            'virtual-footer',
            'Signynt/virtual-footer'
        );

        // JOTS Plugins section
        containerEl.createEl('hr');
        containerEl.createEl('h3', { text: 'JOTS Plugins' });
        containerEl.createEl('p', {
            text: 'Additional plugins that extend JOTS functionality.'
        }).addClass('setting-item-description');

        for (const plugin of JOTS_PLUGINS) {
            const id = plugin.repo.split('/')[1]; // Get plugin ID from repo
            const setting = new Setting(containerEl)
                .setName(plugin.name)
                .setDesc(plugin.description);

            const isInstalled = this.dependencyState[id]?.isInstalled;
            const isLoaded = (this.app as unknown as ExtendedApp).plugins?.plugins[id] !== undefined;
            const isEnabled = isInstalled && isLoaded;

            // Create the main action button (Install/Uninstall)
            setting.addButton(btn => {
                if (!isInstalled) {
                    btn.setButtonText('Install')
                        .setCta()
                        .onClick(async () => {
                            btn.setButtonText('Installing...');
                            btn.setDisabled(true);
                            const success = await this.plugin.pluginManager.addPlugin(plugin.repo);
                            await this.checkDependencies();
                            const state = this.dependencyState[id];

                            if (success && state?.isInstalled) {
                                btn.setButtonText('Uninstall')
                                    .removeCta()
                                    .setDisabled(state.isEnabled);

                                // Add toggle since plugin is now installed
                                setting.addToggle(toggle => {
                                    toggle.setValue(state.isEnabled)
                                        .setTooltip(state.isEnabled ? `Disable ${plugin.name}` : `Enable ${plugin.name}`)
                                        .onChange(async (value) => {
                                            //@ts-ignore - Access internal Obsidian API
                                            if (value) await this.app.plugins.enablePluginAndSave(id);
                                            //@ts-ignore - Access internal Obsidian API
                                            else await this.app.plugins.disablePluginAndSave(id);
                                            await this.checkDependencies();
                                            const newState = this.dependencyState[id];
                                            btn.setDisabled(newState?.isEnabled ?? false);
                                        });
                                });
                            } else {
                                btn.setButtonText('Install')
                                    .setCta()
                                    .setDisabled(false);
                            }
                        });
                } else {
                    btn.setButtonText('Uninstall')
                        .setDisabled(isEnabled)
                        .onClick(async () => {
                            btn.setButtonText('Uninstalling...');
                            btn.setDisabled(true);
                            await this.plugin.pluginManager.uninstallPlugin(id);
                            await this.checkDependencies();
                            const state = this.dependencyState[id];

                            if (!state?.isInstalled) {
                                btn.setButtonText('Install')
                                    .setCta()
                                    .setDisabled(false);

                                // Remove the toggle since plugin is now uninstalled
                                setting.components = setting.components.filter(c => c instanceof ButtonComponent);
                            }
                        });

                    // Add toggle for installed plugins
                    setting.addToggle(toggle => {
                        toggle.setValue(isEnabled)
                            .setTooltip(isEnabled ? `Disable ${plugin.name}` : `Enable ${plugin.name}`)
                            .onChange(async (value) => {
                                //@ts-ignore - Access internal Obsidian API
                                if (value) await this.app.plugins.enablePluginAndSave(id);
                                //@ts-ignore - Access internal Obsidian API
                                else await this.app.plugins.disablePluginAndSave(id);
                                await this.checkDependencies();
                                const newState = this.dependencyState[id];
                                btn.setDisabled(newState?.isEnabled ?? false);
                            });
                    });
                }
            });
        }
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
                    await this.plugin.saveSettings({ refreshType: 'styles' });
                }));

        new Setting(containerEl)
            .setName('Label Color')
            .setDesc('The color of the JOTS callout/section label')
            .addColorPicker(color => color
                .setValue(this.plugin.settings.labelColor)
                .onChange(async (value) => {
                    this.plugin.settings.labelColor = value;
                    await this.plugin.saveSettings({ refreshType: 'styles' });
                }));

        new Setting(containerEl)
            .setName('JOTS Section Icon')
            .setDesc('SVG icon data string for the callout/section (must be valid SVG XML)')
            .addTextArea(text => text
                .setPlaceholder('<svg>...</svg>')
                .setValue(this.plugin.settings.sectionIcon)
                .onChange(async (value) => {
                    this.plugin.settings.sectionIcon = value;
                    await this.plugin.saveSettings({ refreshType: 'styles' });
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

                    // Store all letters in uppercase for consistent comparison                    this.plugin.settings.taskLetters = validLetters;

                    // Show the normalized version (uppercase) to the user
                    if (validLetters.length !== letters.length) {
                        text.setValue(validLetters.join(','));
                    }

                    await this.plugin.saveSettings({ refreshType: 'content' });
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
                    await this.plugin.saveSettings({ refreshViews: false });
                }));

        new Setting(containerEl)
            .setName('Journal Folder Pattern')
            .setDesc('Pattern for journal folder structure (using moment.js format)')
            .addText(text => text
                .setPlaceholder('YYYY/YYYY-MM')
                .setValue(this.plugin.settings.journalFolderPattern)
                .onChange(async (value) => {
                    this.plugin.settings.journalFolderPattern = value;
                    await this.plugin.saveSettings({ refreshViews: false });
                }));

        new Setting(containerEl)
            .setName('Journal File Pattern')
            .setDesc('Pattern for journal file names (using moment.js format)')
            .addText(text => text
                .setPlaceholder('YYYY-MM-DD_ddd')
                .setValue(this.plugin.settings.journalFilePattern)
                .onChange(async (value) => {
                    this.plugin.settings.journalFilePattern = value;
                    await this.plugin.saveSettings({ refreshViews: false });
                }));
    }    // Track expanded state of rules
    private ruleExpandedStates: boolean[] = [];

    private getAvailableFolderPaths(): Set<string> {
        const paths = new Set<string>();
        const files = this.plugin.app.vault.getAllLoadedFiles();
        files.forEach(file => {
            let path = file.parent?.path;
            while (path && path !== '/') {
                paths.add(path + '/');
                path = path.substring(0, path.lastIndexOf('/'));
            }
        });
        paths.add('/'); // Add root folder
        return paths;
    }

    private getAvailableTags(): Set<string> {
        const tags = new Set<string>();
        this.plugin.app.vault.getMarkdownFiles().forEach(file => {
            const fileCache = this.plugin.app.metadataCache.getFileCache(file);
            if (fileCache) {
                const fileTags = getAllTags(fileCache) || [];
                fileTags.forEach(tag => tags.add(tag));
            }
        });
        return tags;
    }

    private getAvailablePropertyNames(): Set<string> {
        const properties = new Set<string>();
        this.plugin.app.vault.getMarkdownFiles().forEach(file => {
            const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
            if (frontmatter) {
                Object.keys(frontmatter).forEach(key => properties.add(key));
            }
        });
        return properties;
    } private getAvailableMarkdownFilePaths(): Set<string> {
        const paths = new Set<string>();
        this.plugin.app.vault.getMarkdownFiles().forEach(file => {
            paths.add(file.path);
        });
        return paths;
    }

    createHeadersFootersSettings(containerEl: HTMLElement): void {
        containerEl.createEl('p', {
            text: 'Configure rules for automatically adding headers and footers to your notes. Each rule can match files by folder, tag, or property.'
        }).addClass('setting-item-description');

        containerEl.createEl('hr');

        // Global settings
        new Setting(containerEl)
            .setName('Refresh on file open')
            .setDesc('Refresh headers and footers when opening a note')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.refreshOnFileOpen ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.refreshOnFileOpen = value;
                    // This only affects future file opens, no need to refresh now
                    await this.plugin.saveSettings({ refreshViews: false });
                }));

        containerEl.createEl('hr');

        // Ensure rules array exists
        if (!this.plugin.settings.rules) {
            this.plugin.settings.rules = DEFAULT_SETTINGS.rules;
        }

        // Initialize expanded states
        while (this.ruleExpandedStates.length < this.plugin.settings.rules.length) {
            this.ruleExpandedStates.push(false);
        }
        if (this.ruleExpandedStates.length > this.plugin.settings.rules.length) {
            this.ruleExpandedStates.length = this.plugin.settings.rules.length;
        }

        // Create container for rules
        const rulesContainer = containerEl.createDiv('rules-container virtual-footer-rules-container');

        // Render rules
        this.plugin.settings.rules.forEach((rule, index) => {
            this.renderRuleControls(rule, index, rulesContainer);
        });

        // Add new rule button
        new Setting(containerEl)
            .addButton(button => button
                .setButtonText('Add new rule')
                .setCta()
                .onClick(async () => {
                    const newRule = {
                        name: 'New Rule',
                        enabled: true,
                        type: RuleType.Folder,
                        path: '',  // Match all files
                        recursive: true,
                        contentSource: ContentSource.Text,
                        footerText: '',
                        renderLocation: RenderLocation.Footer
                    }; this.plugin.settings.rules.push(newRule);
                    this.ruleExpandedStates.push(true);  // New rules start expanded
                    await this.plugin.saveSettings({ refreshType: 'content' });
                    this.display();
                }));
    }

    private renderRuleControls(rule: Rule, index: number, containerEl: HTMLElement): void {
        const ruleDiv = containerEl.createDiv('rule-item virtual-footer-rule-item');

        if (!this.ruleExpandedStates[index]) {
            ruleDiv.addClass('is-collapsed');
        }

        const ruleNameDisplay = rule.name?.trim() || 'Unnamed Rule';
        const ruleHeading = ruleDiv.createEl('h4', {
            text: `Rule ${index + 1}: ${ruleNameDisplay}`,
            cls: 'virtual-footer-rule-heading'
        });

        const ruleContent = ruleDiv.createDiv('virtual-footer-rule-content');

        ruleHeading.addEventListener('click', () => {
            const isNowExpanded = !ruleDiv.classList.toggle('is-collapsed');
            this.ruleExpandedStates[index] = isNowExpanded;
        });

        // Rule Settings
        new Setting(ruleContent)
            .setName('Rule name')
            .setDesc('A descriptive name for this rule')
            .addText(text => text
                .setPlaceholder('e.g., Project Notes Footer')
                .setValue(rule.name || '')
                .onChange(async (value) => {
                    rule.name = value;
                    ruleHeading.textContent = `Rule ${index + 1}: ${value.trim() || 'Unnamed Rule'}`;
                    await this.plugin.saveSettings();
                }));

        new Setting(ruleContent)
            .setName('Enabled')
            .setDesc('If disabled, this rule will not be applied')
            .addToggle(toggle => toggle
                .setValue(rule.enabled ?? true)
                .onChange(async (value) => {
                    rule.enabled = value;
                    await this.plugin.saveSettings({ refreshType: 'content' });
                }));

        new Setting(ruleContent)
            .setName('Rule type')
            .setDesc('Apply this rule based on folder, tag, or property')
            .addDropdown(dropdown => dropdown
                .addOption(RuleType.Folder, 'Folder')
                .addOption(RuleType.Tag, 'Tag')
                .addOption(RuleType.Property, 'Property')
                .setValue(rule.type)
                .onChange(async (value: string) => {
                    rule.type = value as RuleType;
                    await this.plugin.saveSettings({ refreshType: 'content' });
                    this.display();
                }));

        // Type-specific settings
        if (rule.type === RuleType.Folder) {
            new Setting(ruleContent)
                .setName('Folder path')
                .setDesc('Path for the rule. Use "" for all files, "/" for root folder')
                .addText(text => {
                    text.setPlaceholder('e.g., Projects/ or / or empty for all')
                        .setValue(rule.path || '')
                        .onChange(async (value) => {
                            rule.path = value;
                            await this.plugin.saveSettings();
                        });
                    new MultiSuggest(
                        text.inputEl,
                        this.getAvailableFolderPaths(),
                        async (value) => {
                            rule.path = value;
                            text.setValue(value);
                            await this.plugin.saveSettings();
                        },
                        this.plugin.app
                    );
                });

            new Setting(ruleContent)
                .setName('Include subfolders')
                .setDesc('If enabled, rule applies to files in subfolders')
                .addToggle(toggle => toggle
                    .setValue(rule.recursive ?? true)
                    .setDisabled(rule.path === "")
                    .onChange(async (value) => {
                        rule.recursive = value;
                        await this.plugin.saveSettings();
                    }));

        } else if (rule.type === RuleType.Tag) {
            new Setting(ruleContent)
                .setName('Tag')
                .setDesc('Tag to match (without #)')
                .addText(text => {
                    text.setPlaceholder('e.g., project or status/done')
                        .setValue(rule.tag || '')
                        .onChange(async (value) => {
                            rule.tag = value.startsWith('#') ? value.substring(1) : value;
                            await this.plugin.saveSettings();
                        });
                    new MultiSuggest(
                        text.inputEl,
                        this.getAvailableTags(),
                        async (value) => {
                            rule.tag = value.startsWith('#') ? value.substring(1) : value;
                            text.setValue(rule.tag);
                            await this.plugin.saveSettings();
                        },
                        this.plugin.app
                    );
                });

            new Setting(ruleContent)
                .setName('Include subtags')
                .setDesc('If enabled, matches subtags (e.g., project/subtag)')
                .addToggle(toggle => toggle
                    .setValue(rule.includeSubtags ?? false)
                    .onChange(async (value) => {
                        rule.includeSubtags = value;
                        await this.plugin.saveSettings();
                    }));

        } else if (rule.type === RuleType.Property) {
            new Setting(ruleContent)
                .setName('Property name')
                .setDesc('The frontmatter property to match')
                .addText(text => {
                    text.setPlaceholder('e.g., status or type')
                        .setValue(rule.propertyName || '')
                        .onChange(async (value) => {
                            rule.propertyName = value;
                            await this.plugin.saveSettings();
                        });
                    new MultiSuggest(
                        text.inputEl,
                        this.getAvailablePropertyNames(),
                        async (value) => {
                            rule.propertyName = value;
                            text.setValue(value);
                            await this.plugin.saveSettings();
                        },
                        this.plugin.app
                    );
                });

            new Setting(ruleContent)
                .setName('Property value')
                .setDesc('The value the property should have')
                .addText(text => text
                    .setPlaceholder('e.g., complete or draft')
                    .setValue(rule.propertyValue || '')
                    .onChange(async (value) => {
                        rule.propertyValue = value;
                        await this.plugin.saveSettings();
                    }));
        }

        new Setting(ruleContent)
            .setName('Content source')
            .setDesc('Where to get the content from').addDropdown(dropdown => dropdown
                .addOption(ContentSource.Text, 'Direct text')
                .addOption(ContentSource.File, 'Markdown file')
                .setValue(rule.contentSource)
                .onChange(async (value: string) => {
                    rule.contentSource = value as ContentSource;
                    await this.plugin.saveSettings();
                    this.display();
                })); if (rule.contentSource === ContentSource.File) {
                    new Setting(ruleContent)
                        .setName('Content file')
                        .setDesc('The markdown file to use as content')
                        .addText(text => {
                            text.setPlaceholder('e.g., templates/footer.md')
                                .setValue(rule.footerFilePath || '')
                                .onChange(async (value) => {
                                    rule.footerFilePath = value;
                                    await this.plugin.saveSettings({ refreshType: 'content' });
                                }); new MultiSuggest(
                                    text.inputEl,
                                    this.getAvailableMarkdownFilePaths(),
                                    async (value) => {
                                        rule.footerFilePath = value;
                                        text.setValue(value);
                                        await this.plugin.saveSettings();
                                    },
                                    this.plugin.app
                                );
                        });
                } else {
            new Setting(ruleContent)
                .setName('Content')
                .setDesc('The markdown content to insert')
                .addTextArea(text => text
                    .setPlaceholder('Enter markdown content...')
                    .setValue(rule.footerText)
                    .onChange(async (value) => {
                        rule.footerText = value;
                        await this.plugin.saveSettings({ refreshType: 'content' });
                    }));
        }

        new Setting(ruleContent)
            .setName('Render location')
            .setDesc('Where to insert the content')
            .addDropdown(dropdown => dropdown
                .addOption(RenderLocation.Footer, 'Footer')
                .addOption(RenderLocation.Header, 'Header')
                .setValue(rule.renderLocation)
                .onChange(async (value: string) => {
                    rule.renderLocation = value as RenderLocation;
                    await this.plugin.saveSettings({ refreshType: 'content' });
                }));

        // Rule actions
        const ruleActions = new Setting(ruleContent)
            .setClass('virtual-footer-rule-actions');

        // Move Up button
        ruleActions.addButton(button => button
            .setIcon('arrow-up')
            .setTooltip('Move rule up')
            .setDisabled(index === 0)
            .onClick(async () => {
                if (index > 0) {
                    const rules = this.plugin.settings.rules;
                    const rule = rules.splice(index, 1)[0];
                    rules.splice(index - 1, 0, rule);

                    const expandedState = this.ruleExpandedStates.splice(index, 1)[0];
                    this.ruleExpandedStates.splice(index - 1, 0, expandedState);

                    await this.plugin.saveSettings({ refreshType: 'content' });
                    this.display();
                }
            }));

        // Move Down button
        ruleActions.addButton(button => button
            .setIcon('arrow-down')
            .setTooltip('Move rule down')
            .setDisabled(index === this.plugin.settings.rules.length - 1)
            .onClick(async () => {
                if (index < this.plugin.settings.rules.length - 1) {
                    const rules = this.plugin.settings.rules;
                    const rule = rules.splice(index, 1)[0];
                    rules.splice(index + 1, 0, rule);

                    const expandedState = this.ruleExpandedStates.splice(index, 1)[0];
                    this.ruleExpandedStates.splice(index + 1, 0, expandedState);

                    await this.plugin.saveSettings({ refreshType: 'content' });
                    this.display();
                }
            }));

        // Spacer
        ruleActions.controlEl.createDiv({ cls: 'virtual-footer-actions-spacer' });

        // Delete button
        ruleActions.addButton(button => button
            .setButtonText('Delete rule')
            .setWarning()
            .onClick(async () => {
                this.plugin.settings.rules.splice(index, 1);
                this.ruleExpandedStates.splice(index, 1);
                await this.plugin.saveSettings({ refreshType: 'content' });
                this.display();
            }));
    }
}

// --- Virtual Footer Types ---
export enum RuleType {
    Folder = 'folder',
    Tag = 'tag',
    Property = 'property',
}

export enum ContentSource {
    Text = 'text',
    File = 'file'
}

export enum RenderLocation {
    Footer = 'footer',
    Header = 'header',
}

export interface Rule {
    name?: string;
    enabled?: boolean;
    type: RuleType;
    path?: string;
    tag?: string;
    recursive?: boolean;
    includeSubtags?: boolean;
    propertyName?: string;
    propertyValue?: string;
    contentSource: ContentSource;
    footerText: string;
    footerFilePath?: string;
    renderLocation: RenderLocation;
}

export const DEFAULT_SETTINGS: JotsSettings = {
    sectionName: 'JOTS',
    rules: [{
        name: 'Default JOTS Header',
        enabled: true,
        type: RuleType.Folder,
        path: '', // Matches all files
        recursive: true,
        contentSource: ContentSource.Text,
        footerText: '## JOTS\n',
        renderLocation: RenderLocation.Header,
    }, {
        name: 'Default JOTS Footer',
        enabled: true,
        type: RuleType.Folder,
        path: '', // Matches all files
        recursive: true,
        contentSource: ContentSource.Text,
        footerText: '---\nManaged by JOTS',
        renderLocation: RenderLocation.Footer,
    }],
    refreshOnFileOpen: false,
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
    journalFilePattern: 'YYYY-MM-DD_ddd',
    personalAccessToken: '',
    updateAtStartup: true
};

/**
 * A suggestion provider for input fields, offering autocompletion from a given set of strings.
 */
export class MultiSuggest extends AbstractInputSuggest<string> {
    constructor(
        private inputEl: HTMLInputElement,
        private content: Set<string>,
        private onSelectCb: (value: string) => void,
        app: App
    ) {
        super(app, inputEl);
    }

    getSuggestions(inputStr: string): string[] {
        const lowerCaseInputStr = inputStr.toLocaleLowerCase();
        return [...this.content].filter((contentItem) =>
            contentItem.toLocaleLowerCase().includes(lowerCaseInputStr)
        );
    }

    renderSuggestion(content: string, el: HTMLElement): void {
        el.setText(content);
    }

    selectSuggestion(content: string, _evt: MouseEvent | KeyboardEvent): void {
        this.onSelectCb(content);
        this.inputEl.value = content;
        this.inputEl.blur();
        this.close();
    }
}
