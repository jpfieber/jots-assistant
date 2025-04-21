import { App, Modal, Setting } from 'obsidian';
import moment from 'moment';

export interface DateRange {
    startDate: moment.Moment;
    endDate: moment.Moment;
}

export class DateRangeModal extends Modal {
    startDate: moment.Moment;
    endDate: moment.Moment;
    onSubmit: (range: DateRange) => void;

    constructor(app: App, onSubmit: (range: DateRange) => void) {
        super(app);
        this.startDate = moment().startOf('day');
        this.endDate = moment().startOf('day');
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl('h3', { text: 'Select Date Range' });

        new Setting(contentEl)
            .setName('Start Date')
            .addText(text => {
                const input = text.inputEl;
                input.type = 'date';
                input.value = this.startDate.format('YYYY-MM-DD');
                input.onchange = () => {
                    const date = moment(input.value, 'YYYY-MM-DD', true);
                    if (date.isValid()) {
                        this.startDate = date;
                    }
                };
                return text;
            });

        new Setting(contentEl)
            .setName('End Date')
            .addText(text => {
                const input = text.inputEl;
                input.type = 'date';
                input.value = this.endDate.format('YYYY-MM-DD');
                input.onchange = () => {
                    const date = moment(input.value, 'YYYY-MM-DD', true);
                    if (date.isValid()) {
                        this.endDate = date;
                    }
                };
                return text;
            });

        new Setting(contentEl)
            .addButton(btn =>
                btn
                    .setButtonText('Submit')
                    .setCta()
                    .onClick(() => {
                        if (this.startDate.isValid() && this.endDate.isValid()) {
                            this.close();
                            this.onSubmit({
                                startDate: this.startDate,
                                endDate: this.endDate
                            });
                        }
                    }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}