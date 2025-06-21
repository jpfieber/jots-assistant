import { Setting, App, getAllTags } from 'obsidian';
import type JotsPlugin from '../../main';
import { RuleType, ContentSource, RenderLocation, Rule } from '../../types';
import { DEFAULT_SETTINGS } from '../../constants';
import { MultiSuggest } from '../../utils/MultiSuggest';

export class HeadersFootersSection {
    private ruleExpandedStates: boolean[] = [];

    constructor(private plugin: JotsPlugin, private app: App) { }

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
    }

    private getAvailableMarkdownFilePaths(): Set<string> {
        const paths = new Set<string>();
        this.plugin.app.vault.getMarkdownFiles().forEach(file => {
            paths.add(file.path);
        });
        return paths;
    }

    display(containerEl: HTMLElement): void {
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
        const rulesContainer = containerEl.createDiv('rules-container virtual-footer-rules-container');        // Render rules
        this.plugin.settings.rules.forEach((rule: Rule, index: number) => {
            this.renderRuleControls(rule, index, rulesContainer);
        });

        // Add new rule button
        new Setting(containerEl)
            .addButton(button => button
                .setButtonText('Add new rule')
                .setCta()
                .onClick(async () => {                    const newRule = {
                        name: 'New Rule',
                        enabled: true,
                        type: RuleType.Folder,
                        path: '',  // Match all files
                        recursive: true,
                        contentSource: ContentSource.Text,
                        footerText: '',
                        renderLocation: RenderLocation.Footer
                    };
                    this.plugin.settings.rules.push(newRule);
                    this.ruleExpandedStates.push(true);  // New rules start expanded
                    await this.plugin.saveSettings({ refreshType: 'content' });
                    
                    // Just render the new rule at the end of the rules container                    const rulesContainer = containerEl.querySelector('.rules-container') as HTMLElement;
                    if (rulesContainer) {
                        this.renderRuleControls(newRule, this.plugin.settings.rules.length - 1, rulesContainer);
                    }
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
                    this.display(containerEl);
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
            .setDesc('Where to get the content from')
            .addDropdown(dropdown => dropdown
                .addOption(ContentSource.Text, 'Direct text')
                .addOption(ContentSource.File, 'Markdown file')
                .setValue(rule.contentSource)
                .onChange(async (value: string) => {
                    rule.contentSource = value as ContentSource;
                    await this.plugin.saveSettings();
                    this.display(containerEl);
                }));

        if (rule.contentSource === ContentSource.File) {
            new Setting(ruleContent)
                .setName('Content file')
                .setDesc('The markdown file to use as content')
                .addText(text => {
                    text.setPlaceholder('e.g., templates/footer.md')
                        .setValue(rule.footerFilePath || '')
                        .onChange(async (value) => {
                            rule.footerFilePath = value;
                            await this.plugin.saveSettings();
                        });
                    new MultiSuggest(
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
                        await this.plugin.saveSettings();
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
                    // Swap rules
                    const temp = this.plugin.settings.rules[index];
                    this.plugin.settings.rules[index] = this.plugin.settings.rules[index - 1];
                    this.plugin.settings.rules[index - 1] = temp;

                    // Swap expanded states
                    const tempState = this.ruleExpandedStates[index];
                    this.ruleExpandedStates[index] = this.ruleExpandedStates[index - 1];
                    this.ruleExpandedStates[index - 1] = tempState;

                    await this.plugin.saveSettings({ refreshType: 'content' });
                    this.display(containerEl);
                }
            }));

        // Move Down button
        ruleActions.addButton(button => button
            .setIcon('arrow-down')
            .setTooltip('Move rule down')
            .setDisabled(index === this.plugin.settings.rules.length - 1)
            .onClick(async () => {
                if (index < this.plugin.settings.rules.length - 1) {
                    // Swap rules
                    const temp = this.plugin.settings.rules[index];
                    this.plugin.settings.rules[index] = this.plugin.settings.rules[index + 1];
                    this.plugin.settings.rules[index + 1] = temp;

                    // Swap expanded states
                    const tempState = this.ruleExpandedStates[index];
                    this.ruleExpandedStates[index] = this.ruleExpandedStates[index + 1];
                    this.ruleExpandedStates[index + 1] = tempState;

                    await this.plugin.saveSettings({ refreshType: 'content' });
                    this.display(containerEl);
                }
            }));

        // Delete button
        ruleActions.addButton(button => button
            .setIcon('trash')
            .setTooltip('Delete rule')
            .onClick(async () => {
                this.plugin.settings.rules.splice(index, 1);
                this.ruleExpandedStates.splice(index, 1);
                await this.plugin.saveSettings({ refreshType: 'content' });
                this.display(containerEl);
            }));
    }
}
