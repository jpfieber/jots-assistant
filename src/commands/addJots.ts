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
        // Search backwards from the task line to find the nearest callout header
        let nearestCalloutStart = -1;
        let nearestCalloutEnd = -1;

        // Find the nearest callout header before this task
        for (let i = taskLineIndex - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (line.match(/^>\s*\[!.*\]/)) {
                nearestCalloutStart = i;
                break;
            }
        }

        // If we found a callout header before this task
        if (nearestCalloutStart !== -1) {
            // Find where this callout ends (first non-quoted line after the header)
            for (let i = nearestCalloutStart + 1; i < lines.length; i++) {
                if (!lines[i].trimStart().startsWith('>')) {
                    nearestCalloutEnd = i - 1;
                    break;
                }
                // If we reach the end of the file, the callout extends to the end
                if (i === lines.length - 1) {
                    nearestCalloutEnd = i;
                }
            }

            // Check if our task falls within this callout's range
            return taskLineIndex > nearestCalloutStart && taskLineIndex <= nearestCalloutEnd;
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

        // First, remove the tasks from their original locations
        // Sort indices in reverse order to maintain correct positions during removal
        const taskIndices = tasksToMove.map(task => task.index).sort((a, b) => b - a);

        // Remove tasks and their adjacent empty lines
        let removedLines = 0;
        for (const index of taskIndices) {
            const adjustedIndex = index - removedLines;

            // Check and remove previous empty line
            if (adjustedIndex > 0 && lines[adjustedIndex - 1].trim() === '') {
                lines.splice(adjustedIndex - 1, 1);
                removedLines++;
            }

            // Remove the task line itself
            lines.splice(adjustedIndex - removedLines, 1);
            removedLines++;

            // Check and remove next empty line
            if (adjustedIndex - removedLines < lines.length && lines[adjustedIndex - removedLines]?.trim() === '') {
                lines.splice(adjustedIndex - removedLines, 1);
                removedLines++;
            }
        }

        // Now handle the callout section
        if (existingCalloutIndex !== -1) {
            // Find the end of the callout section
            let calloutEndIndex = existingCalloutIndex;
            for (let i = existingCalloutIndex + 1; i < lines.length; i++) {
                if (!lines[i].trimStart().startsWith('>')) {
                    calloutEndIndex = i - 1;
                    break;
                }
                if (i === lines.length - 1) {
                    calloutEndIndex = i;
                }
            }

            // Extract existing tasks from the callout
            const existingTasks: TaskWithTime[] = [];
            for (let i = existingCalloutIndex + 1; i <= calloutEndIndex; i++) {
                const line = lines[i].trim();
                const taskMatch = line.match(/^>\s*-\s*\[([A-Za-z])\]/);
                if (taskMatch) {
                    const time = this.extractTimeFromTask(line);
                    existingTasks.push({ line, index: i, time });
                }
            }

            // Update the callout format if needed
            changed = this.updateCalloutFormat(lines, existingCalloutIndex) || changed;

            if (tasksToMove.length > 0 || existingTasks.length > 0) {
                changed = true;
                // Combine and sort all tasks
                const allTasks = this.sortTasks([...existingTasks, ...tasksToMove]);

                // Replace the existing callout content
                lines.splice(existingCalloutIndex + 1, calloutEndIndex - existingCalloutIndex, ...allTasks.map(task => task.line));
            }
        } else if (tasksToMove.length > 0) {
            changed = true;
            const calloutString = this.createCalloutString(this.plugin.settings.sectionFormat);
            const sortedTasks = tasksToMove.map(task => task.line).join('\n');

            // Add the callout section
            lines.push('');
            lines.push(calloutString + '\n' + sortedTasks);
        }

        if (!changed) {
            return null;
        }

        // Clean up any remaining consecutive empty lines
        for (let i = lines.length - 2; i >= 0; i--) {
            if (lines[i].trim() === '' && lines[i + 1].trim() === '') {
                lines.splice(i, 1);
            }
        }

        return lines.join('\n');
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