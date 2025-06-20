import { Setting, App } from 'obsidian';
import type JotsPlugin from '../../main';
import { JotsSectionFormat } from '../../types';

export class AppearanceSection {
    constructor(private plugin: JotsPlugin, private app: App) { }

    display(containerEl: HTMLElement): void {
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

        new Setting(containerEl).setName('Task Letters')
            .setDesc('Letters to look for in custom tasks (comma-separated, e.g. "A,B,C"). The JOTS header will only be added to notes containing tasks with these letters. Case-insensitive.')
            .addText(text => text
                .setPlaceholder('A,B,C')
                .setValue(this.plugin.settings.taskLetters.join(','))
                .onChange(async (value) => {
                    // Let users type what they want, we'll normalize when saving
                    let normalized = value.toUpperCase();

                    // Store the actual valid task letters (single letters A-Z)
                    const validLetters = normalized.split(',')
                        .map(letter => letter.trim())
                        .filter(letter => /^[A-Z]$/.test(letter));

                    // Only save valid letters to settings
                    this.plugin.settings.taskLetters = validLetters;
                    await this.plugin.saveSettings({ refreshType: 'content' });
                }));
    }
}
