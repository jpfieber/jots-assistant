import { App, Setting } from 'obsidian';
import { Event, EventType } from '../../types';
import JotsPlugin from '../../main';

export class EventsSection {
    constructor(
        private plugin: JotsPlugin,
        private app: App
    ) {}

    display(containerEl: HTMLElement): void {
        containerEl.empty();

        // Description
        new Setting(containerEl)
            .setName('Events Management')
            .setDesc('Configure birthdays, anniversaries, and other recurring events that can be automatically added to your daily journal.')
            .setClass('jots-settings-description');

        // Global event settings
        new Setting(containerEl)
            .setName('Event Task Letter')
            .setDesc('Letter to use in task brackets [e] for all events')
            .addText(text => text
                .setPlaceholder('e')
                .setValue(this.plugin.settings.eventTaskLetter || 'e')
                .onChange(async (value) => {
                    const letter = value.slice(0, 1) || 'e';
                    this.plugin.settings.eventTaskLetter = letter;
                    await this.plugin.saveSettings({ refreshType: 'content' });
                    text.setValue(letter);
                }));

        new Setting(containerEl)
            .setName('Event Emoji')
            .setDesc('Emoji to use for all events (type:: 🎈)')
            .addText(text => text
                .setPlaceholder('🎈')
                .setValue(this.plugin.settings.eventEmoji || '🎈')
                .onChange(async (value) => {
                    const emoji = value.slice(0, 2) || '🎈';
                    this.plugin.settings.eventEmoji = emoji;
                    await this.plugin.saveSettings({ refreshType: 'content' });
                    text.setValue(emoji);
                }));

        // Events table
        const eventsContainer = containerEl.createDiv('events-table-container');
        
        // Create table header
        const headerRow = eventsContainer.createDiv('events-table-header');
        headerRow.createSpan({ text: 'Enabled', cls: 'events-header-cell events-enabled-col' });
        headerRow.createSpan({ text: 'Name', cls: 'events-header-cell events-name-col' });
        headerRow.createSpan({ text: 'Date', cls: 'events-header-cell events-date-col' });
        headerRow.createSpan({ text: 'Type', cls: 'events-header-cell events-type-col' });
        headerRow.createSpan({ text: 'Actions', cls: 'events-header-cell events-actions-col' });

        // Create event rows
        this.plugin.settings.events.forEach((event: Event, index: number) => {
            this.renderEventRow(event, index, eventsContainer);
        });

        // Add new event button
        new Setting(containerEl)
            .addButton(button => button
                .setButtonText('Add New Event')
                .setClass('mod-cta')
                .onClick(async () => {
                    const newEvent: Event = {
                        id: this.generateEventId(),
                        name: 'New Event',
                        date: '2000-01-01',
                        eventType: EventType.Birthday,
                        enabled: true
                    };
                    this.plugin.settings.events.push(newEvent);
                    await this.plugin.saveSettings({ refreshType: 'content' });
                    this.display(containerEl);
                }));
    }

    private generateEventId(): string {
        return 'event_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    private renderEventRow(event: Event, index: number, containerEl: HTMLElement): void {
        const eventRow = containerEl.createDiv('events-table-row');

        // Enabled checkbox
        const enabledCell = eventRow.createDiv('events-cell events-enabled-col');
        const checkbox = enabledCell.createEl('input', { type: 'checkbox' });
        checkbox.checked = event.enabled;
        checkbox.addEventListener('change', async () => {
            this.plugin.settings.events[index].enabled = checkbox.checked;
            await this.plugin.saveSettings({ refreshType: 'content' });
        });

        // Name input
        const nameCell = eventRow.createDiv('events-cell events-name-col');
        const nameInput = nameCell.createEl('input', { type: 'text', value: event.name });
        nameInput.addEventListener('blur', async () => {
            this.plugin.settings.events[index].name = nameInput.value;
            await this.plugin.saveSettings({ refreshType: 'content' });
        });

        // Date input
        const dateCell = eventRow.createDiv('events-cell events-date-col');
        const dateInput = dateCell.createEl('input', { type: 'text', value: event.date });
        dateInput.placeholder = 'YYYY-MM-DD';
        dateInput.addEventListener('blur', async () => {
            if (dateInput.value.match(/^\d{4}-\d{2}-\d{2}$/)) {
                this.plugin.settings.events[index].date = dateInput.value;
                await this.plugin.saveSettings({ refreshType: 'content' });
            } else {
                dateInput.value = event.date; // Reset to valid value
            }
        });

        // Type dropdown
        const typeCell = eventRow.createDiv('events-cell events-type-col');
        const typeSelect = typeCell.createEl('select');
        Object.values(EventType).forEach(type => {
            const option = typeSelect.createEl('option', { value: type, text: type });
            if (type === event.eventType) {
                option.selected = true;
            }
        });
        typeSelect.addEventListener('change', async () => {
            this.plugin.settings.events[index].eventType = typeSelect.value as EventType;
            await this.plugin.saveSettings({ refreshType: 'content' });
        });

        // Actions
        const actionsCell = eventRow.createDiv('events-cell events-actions-col');
        
        // Move up button
        if (index > 0) {
            const moveUpBtn = actionsCell.createEl('button', { cls: 'events-action-btn' });
            moveUpBtn.innerHTML = '↑';
            moveUpBtn.title = 'Move up';
            moveUpBtn.addEventListener('click', async () => {
                const temp = this.plugin.settings.events[index];
                this.plugin.settings.events[index] = this.plugin.settings.events[index - 1];
                this.plugin.settings.events[index - 1] = temp;
                await this.plugin.saveSettings({ refreshType: 'content' });
                this.display(containerEl.parentElement as HTMLElement);
            });
        }

        // Move down button
        if (index < this.plugin.settings.events.length - 1) {
            const moveDownBtn = actionsCell.createEl('button', { cls: 'events-action-btn' });
            moveDownBtn.innerHTML = '↓';
            moveDownBtn.title = 'Move down';
            moveDownBtn.addEventListener('click', async () => {
                const temp = this.plugin.settings.events[index];
                this.plugin.settings.events[index] = this.plugin.settings.events[index + 1];
                this.plugin.settings.events[index + 1] = temp;
                await this.plugin.saveSettings({ refreshType: 'content' });
                this.display(containerEl.parentElement as HTMLElement);
            });
        }

        // Delete button
        const deleteBtn = actionsCell.createEl('button', { cls: 'events-action-btn events-delete-btn' });
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.title = 'Delete event';
        deleteBtn.addEventListener('click', async () => {
            this.plugin.settings.events.splice(index, 1);
            await this.plugin.saveSettings({ refreshType: 'content' });
            this.display(containerEl.parentElement as HTMLElement);
        });
    }
}
