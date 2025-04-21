import { Command, Editor, MarkdownView, TFile } from 'obsidian';
import JotsPlugin from '../main';
import { JotsSectionFormat } from '../settings';

interface TaskWithTime {
    line: string;
    index: number;
    time?: string;  // Store the time in HH:mm format
}

export class AddJotsCommand implements Command {
    id = 'add-jots-to-journals';
    name = 'Add JOTS to Journals';
    plugin: JotsPlugin;

    constructor(plugin: JotsPlugin) {
        this.plugin = plugin;
    }

    createCalloutString(format: JotsSectionFormat): string {
        const { sectionName } = this.plugin.settings;
        let callout = `> [!${sectionName.toLowerCase()}]`;

        switch (format) {
            case 'Foldable-Open':
                callout += '+';
                break;
            case 'Foldable-Closed':
                callout += '-';
                break;
            case 'Plain':
            default:
                break;
        }

        return callout;
    }

    extractTimeFromTask(taskLine: string): string | undefined {
        // Look for time field in format (time:: HH:mm)
        const timeMatch = taskLine.match(/\(time::\s*(\d{1,2}:\d{2})\)/);
        return timeMatch ? timeMatch[1] : undefined;
    }

    getTaskLetter(taskLine: string): string | undefined {
        const match = taskLine.match(/^>\s*-\s*\[([A-Za-z])\]/);
        return match ? match[1].toUpperCase() : undefined;
    }

    sortTasks(tasks: TaskWithTime[]): TaskWithTime[] {
        // Separate tasks with and without time
        const withTime = tasks.filter(t => t.time !== undefined);
        const withoutTime = tasks.filter(t => t.time === undefined);

        // Sort tasks with time in ascending order
        withTime.sort((a, b) => {
            if (!a.time || !b.time) return 0;

            // Convert HH:mm to minutes for comparison
            const [hoursA, minutesA] = a.time.split(':').map(Number);
            const [hoursB, minutesB] = b.time.split(':').map(Number);

            const totalMinutesA = hoursA * 60 + minutesA;
            const totalMinutesB = hoursB * 60 + minutesB;

            return totalMinutesA - totalMinutesB; // Ascending order
        });

        // Group non-timed tasks by their letter
        const tasksByLetter: { [key: string]: TaskWithTime[] } = {};
        withoutTime.forEach(task => {
            const letter = this.getTaskLetter(task.line);
            if (letter) {
                if (!tasksByLetter[letter]) {
                    tasksByLetter[letter] = [];
                }
                tasksByLetter[letter].push(task);
            }
        });

        // Order the groups according to settings order
        const orderedNonTimesTasks: TaskWithTime[] = [];
        this.plugin.settings.taskLetters.forEach(letter => {
            if (tasksByLetter[letter]) {
                orderedNonTimesTasks.push(...tasksByLetter[letter]);
            }
        });

        // Return time-based tasks first, followed by letter-grouped tasks
        return [...withTime, ...orderedNonTimesTasks];
    }

    hasExistingCallout(content: string): boolean {
        const { sectionName } = this.plugin.settings;
        const calloutPattern = new RegExp(`^> \\[!${sectionName.toLowerCase()}\\](?:[+\\-]|\\s|$)`, 'm');
        return calloutPattern.test(content);
    }

    findExistingCalloutIndex(lines: string[]): number {
        const { sectionName } = this.plugin.settings;
        const calloutPattern = new RegExp(`^> \\[!${sectionName.toLowerCase()}\\](?:[+\\-]|\\s|$)`);
        return lines.findIndex(line => calloutPattern.test(line));
    }

    isTaskInCallout(lines: string[], taskLineIndex: number): boolean {
        // Search backwards from the task line
        for (let i = taskLineIndex - 1; i >= 0; i--) {
            const line = lines[i].trim();

            // If we find a callout header
            if (line.match(/^>\s*\[!.*\]/)) {
                // Check all lines between header and task start with ">"
                for (let j = i + 1; j <= taskLineIndex; j++) {
                    if (!lines[j].trimStart().startsWith('>')) {
                        return false;
                    }
                }
                return true;
            }

            // If we find a line that doesn't start with ">", task is not in a callout
            if (!line.startsWith('>')) {
                return false;
            }
        }

        return false;
    }

    findTasksToMove(lines: string[]): TaskWithTime[] {
        const tasksToMove: TaskWithTime[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const taskMatch = line.match(/^(>?\s*)-\s*\[([A-Za-z])\]/);

            if (taskMatch) {
                const letterFound = taskMatch[2].toUpperCase();
                const startsWithQuote = line.trimStart().startsWith('>');

                if (this.plugin.settings.taskLetters.includes(letterFound)) {
                    if (!startsWithQuote || !this.isTaskInCallout(lines, i)) {
                        // Always ensure tasks start with "> " when moving them
                        const taskLine = line.trim();
                        const formattedTask = taskLine.startsWith('>') ? taskLine : `> ${taskLine}`;
                        const time = this.extractTimeFromTask(formattedTask);
                        tasksToMove.push({ line: formattedTask, index: i, time });
                    }
                }
            }
        }

        return this.sortTasks(tasksToMove);
    }

    getCalloutFormatFromLine(line: string): JotsSectionFormat {
        const { sectionName } = this.plugin.settings;
        if (line.match(new RegExp(`^> \\[!${sectionName.toLowerCase()}\\]\\+`))) {
            return 'Foldable-Open';
        } else if (line.match(new RegExp(`^> \\[!${sectionName.toLowerCase()}\\]\\-`))) {
            return 'Foldable-Closed';
        }
        return 'Plain';
    }

    updateCalloutFormat(lines: string[], calloutIndex: number): boolean {
        const currentLine = lines[calloutIndex];
        const currentFormat = this.getCalloutFormatFromLine(currentLine);
        const desiredFormat = this.plugin.settings.sectionFormat;

        if (currentFormat !== desiredFormat) {
            const { sectionName } = this.plugin.settings;
            const baseCallout = `> [!${sectionName.toLowerCase()}]`;
            let newCallout = baseCallout;

            switch (desiredFormat) {
                case 'Foldable-Open':
                    newCallout += '+';
                    break;
                case 'Foldable-Closed':
                    newCallout += '-';
                    break;
            }

            lines[calloutIndex] = newCallout;
            return true;
        }
        return false;
    }

    async processFileContent(content: string): Promise<string | null> {
        const lines = content.split('\n');
        const tasksToMove = this.findTasksToMove(lines);
        const existingCalloutIndex = this.findExistingCalloutIndex(lines);
        let changed = false;

        if (existingCalloutIndex !== -1) {
            // Check and update callout format if needed
            changed = this.updateCalloutFormat(lines, existingCalloutIndex);

            // Find existing tasks in the callout
            let calloutEndIndex = existingCalloutIndex + 1;
            const existingTasks: TaskWithTime[] = [];

            while (calloutEndIndex < lines.length && lines[calloutEndIndex].trimStart().startsWith('>')) {
                const line = lines[calloutEndIndex].trim();
                const taskMatch = line.match(/^>\s*-\s*\[([A-Za-z])\]/);
                if (taskMatch) {
                    const time = this.extractTimeFromTask(line);
                    existingTasks.push({ line, index: calloutEndIndex, time });
                }
                calloutEndIndex++;
            }

            // If we have tasks to move or existing tasks
            if (tasksToMove.length > 0 || existingTasks.length > 0) {
                changed = true;
                // Combine and sort all tasks
                const allTasks = this.sortTasks([...existingTasks, ...tasksToMove]);

                // Replace the existing callout content
                lines.splice(existingCalloutIndex + 1, calloutEndIndex - existingCalloutIndex - 1);
                lines.splice(existingCalloutIndex + 1, 0, ...allTasks.map(task => task.line));

                // Remove original tasks that were moved (in reverse order)
                for (let i = tasksToMove.length - 1; i >= 0; i--) {
                    lines[tasksToMove[i].index] = '';
                }
            }
        } else if (tasksToMove.length > 0) {
            changed = true;
            // Create new callout with sorted tasks
            const calloutString = this.createCalloutString(this.plugin.settings.sectionFormat);
            const sortedTasks = tasksToMove.map(task => task.line).join('\n');

            // Remove original tasks (in reverse order)
            for (let i = tasksToMove.length - 1; i >= 0; i--) {
                lines[tasksToMove[i].index] = '';
            }

            // Add the callout section
            lines.push(calloutString + '\n' + sortedTasks);
        }

        if (!changed) {
            return null;
        }

        // Clean up the content and handle spacing
        let cleanedLines = lines.filter(line => line !== '');

        const finalCalloutIndex = cleanedLines.findIndex(line => {
            const { sectionName } = this.plugin.settings;
            return new RegExp(`^> \\[!${sectionName.toLowerCase()}\\](?:[+\\-]|\\s|$)`).test(line);
        });

        if (finalCalloutIndex > 0) {
            while (finalCalloutIndex > 0 && cleanedLines[finalCalloutIndex - 1].trim() === '') {
                cleanedLines.splice(finalCalloutIndex - 1, 1);
            }
            cleanedLines.splice(finalCalloutIndex, 0, '');
        }

        return cleanedLines.join('\n');
    }

    async processActiveFile() {
        const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;

        const content = activeView.editor.getValue();
        const newContent = await this.processFileContent(content);

        if (newContent !== null) {
            activeView.editor.setValue(newContent);
        }
    }

    async processFile(file: TFile): Promise<boolean> {
        const content = await this.plugin.app.vault.read(file);
        const newContent = await this.processFileContent(content);

        if (newContent !== null) {
            await this.plugin.app.vault.modify(file, newContent);
            return true;
        }
        return false;
    }

    async callback() {
        await this.processActiveFile();
    }
}