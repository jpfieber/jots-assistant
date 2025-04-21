import { App, Command, TFile } from 'obsidian';
import { JotsSettings } from '../settings';
import { AddJotsCommand } from './addJots';
import { DateRangeModal, DateRange } from './dateRangeModal';
import * as moment from 'moment';

export class AddJotsRangeCommand implements Command {
    id = 'add-jots-to-journal-range';
    name = 'Add JOTS to Journal Range';
    private app: App;
    private settings: JotsSettings;
    private addJotsCommand: AddJotsCommand;

    constructor(app: App, settings: JotsSettings, addJotsCommand: AddJotsCommand) {
        this.app = app;
        this.settings = settings;
        this.addJotsCommand = addJotsCommand;
    }

    async callback() {
        const range = await openDateRangeModal(this.app);
        if (!range) return;

        const { startDate, endDate } = range;
        const currentDate = startDate.clone();

        while (currentDate <= endDate) {
            const folderPath = currentDate.format(this.settings.journalFolderPattern);
            const fileName = currentDate.format(this.settings.journalFilePattern) + '.md';
            const fullPath = `${this.settings.journalRootFolder}/${folderPath}/${fileName}`;

            const file = this.app.vault.getAbstractFileByPath(fullPath);
            if (file instanceof TFile) {
                await this.addJotsCommand.processFile(file);
            }

            currentDate.add(1, 'day');
        }
    }
}

async function openDateRangeModal(app: App): Promise<DateRange | null> {
    return new Promise((resolve) => {
        const modal = new DateRangeModal(app, (range: DateRange) => {
            resolve(range);
        });
        modal.open();
    });
}