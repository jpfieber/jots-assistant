import { Setting, App } from 'obsidian';
import type JotsPlugin from '../../main';

export class JournalSection {
    constructor(private plugin: JotsPlugin, private app: App) { }

    display(containerEl: HTMLElement): void {
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
    }
}
