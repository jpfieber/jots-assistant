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
            // Specifically check for JOTS callout
            if (line.match(new RegExp(`^> \\[!${this.plugin.settings.sectionName.toLowerCase()}\\](?:[+\\-]|\\s|$)`))) {
                nearestCalloutStart = i;
                break;
            }
        }

        // If we found a JOTS callout header before this task
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
        // Split content while preserving YAML frontmatter
        const yamlRegex = /^---\n([\s\S]*?)\n---/;
        const yamlMatch = content.match(yamlRegex);
        const yamlFrontmatter = yamlMatch ? yamlMatch[0] : null;
        let contentWithoutYaml = yamlMatch ? content.slice(yamlMatch[0].length).trim() : content.trim();

        const lines = contentWithoutYaml.split('\n');

        // Find and preserve the title line and any content before first task
        const titleLineIndex = lines.findIndex(line => line.trim().startsWith('#'));
        let contentBeforeTasks: string[] = [];

        if (titleLineIndex !== -1) {
            // Keep the title and any content until the first task, preserving original spacing
            let i = 0;
            while (i < lines.length) {
                const line = lines[i];
                if (!line.match(/^(>?\s*)?-\s*\[([A-Za-z])\]/)) {
                    contentBeforeTasks.push(line);
                    lines.splice(i, 1);
                } else {
                    break;
                }
            }
            // Trim any extra blank lines at the end of contentBeforeTasks
            while (contentBeforeTasks.length > 0 && contentBeforeTasks[contentBeforeTasks.length - 1].trim() === '') {
                contentBeforeTasks.pop();
            }
        }

        const tasksToMove = this.findTasksToMove(lines);
        let existingCalloutIndex = this.findExistingCalloutIndex(lines);
        let changed = false;

        // First, remove the tasks from their original locations
        // Create a set of normalized task strings for comparison
        const normalizedTasksToRemove = new Set(
            tasksToMove.map(task => task.line.replace(/^>\s*/, '').trim().replace(/\s+/g, ' '))
        );

        // Remove tasks and their adjacent empty lines
        let i = lines.length - 1;
        while (i >= 0) {
            const line = lines[i];
            const trimmedLine = line.trim();

            if (trimmedLine) {
                // Normalize the current line for comparison
                const normalizedLine = trimmedLine.replace(/^>\s*/, '').trim().replace(/\s+/g, ' ');

                if (normalizedTasksToRemove.has(normalizedLine)) {
                    // Remove the task line
                    lines.splice(i, 1);

                    // Check and remove adjacent empty lines
                    if (i > 0 && !lines[i - 1].trim()) {
                        lines.splice(i - 1, 1);
                        i--;
                    }
                    if (i < lines.length && !lines[i]?.trim()) {
                        lines.splice(i, 1);
                    }

                    changed = true;
                }
            }
            i--;
        }

        // Clean up any remaining consecutive empty lines
        i = lines.length - 1;
        while (i >= 0) {
            if (lines[i].trim() === '' && (i === lines.length - 1 || (i > 0 && lines[i - 1].trim() === ''))) {
                lines.splice(i, 1);
            }
            i--;
        }

        // Now handle the callout section
        if (existingCalloutIndex !== -1) {
            existingCalloutIndex = this.findExistingCalloutIndex(lines); // Recalculate after removals

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

                // Handle spacing before callout - ensure exactly one blank line
                if (existingCalloutIndex > 0) {
                    // Remove any existing blank lines before the callout
                    while (existingCalloutIndex > 0 && lines[existingCalloutIndex - 1].trim() === '') {
                        lines.splice(existingCalloutIndex - 1, 1);
                        existingCalloutIndex--;
                        calloutEndIndex--;
                    }
                    // Add exactly one blank line before the callout if we're not at the start
                    if (existingCalloutIndex > 0) {
                        lines.splice(existingCalloutIndex, 0, '');
                        existingCalloutIndex++;
                        calloutEndIndex++;
                    }
                }

                // Replace the existing callout content
                lines.splice(existingCalloutIndex + 1, calloutEndIndex - existingCalloutIndex, ...allTasks.map(task => task.line));
            }
        } else if (tasksToMove.length > 0) {
            changed = true;
            const calloutString = this.createCalloutString(this.plugin.settings.sectionFormat);
            const sortedTasks = tasksToMove.map(task => task.line).join('\n');

            // Clean up trailing empty lines before adding the callout
            while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
                lines.pop();
            }

            // Add exactly one blank line before the callout if there's content
            if (lines.length > 0) {
                lines.push('');
            }
            lines.push(calloutString);
            lines.push(...sortedTasks.split('\n'));
        }

        if (!changed) {
            return null;
        }

        // Reconstruct the file with preserved content
        let finalContent: string[] = [];

        // Add YAML if it existed
        if (yamlFrontmatter) {
            finalContent.push(yamlFrontmatter);
            finalContent.push('');
        }

        // Add title and preserved content with proper spacing
        if (contentBeforeTasks.length > 0) {
            finalContent.push(...contentBeforeTasks);
            if (lines.length > 0) {
                finalContent.push('');  // Single blank line after title before content
            }
        }

        // Add the processed content
        finalContent.push(...lines);

        // Clean up any trailing empty lines
        while (finalContent.length > 0 && finalContent[finalContent.length - 1].trim() === '') {
            finalContent.pop();
        }

        return finalContent.join('\n');
    }

    findTasksToMove(lines: string[]): TaskWithTime[] {
        const tasksToMove: TaskWithTime[] = [];
        const seenTasks = new Set<string>(); // To prevent duplicates

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Match tasks with or without blockquote prefix, being more lenient with whitespace
            const taskMatch = line.match(/^(>?\s*)?-\s*\[([A-Za-z])\]/);

            if (taskMatch) {
                const letterFound = taskMatch[2].toUpperCase();

                if (this.plugin.settings.taskLetters.includes(letterFound)) {
                    // Skip if task is already in a JOTS callout
                    if (!this.isTaskInCallout(lines, i)) {
                        // Clean and normalize the task format
                        const taskLine = line.trim().replace(/^>\s*/, '').trim(); // Remove any leading '>' and whitespace
                        const formattedTask = `> ${taskLine}`; // Add the '>' prefix consistently

                        // Only add if we haven't seen this exact task before
                        const normalizedTask = formattedTask.replace(/\s+/g, ' '); // Normalize whitespace for comparison
                        if (!seenTasks.has(normalizedTask)) {
                            const time = this.extractTimeFromTask(formattedTask);
                            tasksToMove.push({ line: formattedTask, index: i, time });
                            seenTasks.add(normalizedTask);
                        }
                    }
                }
            }
        }

        return this.sortTasks(tasksToMove);
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