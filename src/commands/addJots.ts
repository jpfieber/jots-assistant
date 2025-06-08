import { Command, Editor, MarkdownView, TFile } from 'obsidian';
import JotsPlugin from '../main';
import { JotsSectionFormat } from '../settings';

interface TaskWithTime {
    line: string;
    index: number;
    time?: string;  // Store the time in HH:mm format
}

interface JotsSection {
    startIndex: number;
    endIndex: number;
    items: TaskWithTime[];
}

export async function addJotsToJournal(plugin: JotsPlugin, file: TFile): Promise<boolean> {
    const command = new AddJotsCommand(plugin);
    return command.processFile(file);
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
        this.plugin.settings.taskLetters.forEach((letter: string) => {
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

    findExistingCalloutSections(lines: string[]): { startIndex: number; endIndex: number }[] {
        const sections: { startIndex: number; endIndex: number }[] = [];
        const { sectionName } = this.plugin.settings;
        const calloutPattern = new RegExp(`^> \\[!${sectionName.toLowerCase()}\\](?:[+\\-]|\\s|$)`);

        for (let i = 0; i < lines.length; i++) {
            if (calloutPattern.test(lines[i].trim())) {
                let endIndex = i;
                // Find the end of this callout section
                for (let j = i + 1; j < lines.length; j++) {
                    if (!lines[j].trimStart().startsWith('>')) {
                        endIndex = j - 1;
                        break;
                    }
                    if (j === lines.length - 1) {
                        endIndex = j;
                    }
                }
                sections.push({ startIndex: i, endIndex: endIndex });
                i = endIndex; // Skip to end of this section
            }
        }
        return sections;
    }

    findJotsSection(lines: string[]): JotsSection | null {
        const { sectionName } = this.plugin.settings;
        const headerPattern = new RegExp(`^> \\[!${sectionName.toLowerCase()}\\](?:[+\\-]|\\s|$)`);

        // Find JOTS header
        const headerIndex = lines.findIndex(line => headerPattern.test(line));
        if (headerIndex === -1) return null;

        // Find end of JOTS section
        let endIndex = headerIndex;
        const items: TaskWithTime[] = [];

        for (let i = headerIndex + 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line.startsWith('> -')) {
                endIndex = i - 1;
                break;
            }
            if (i === lines.length - 1) {
                endIndex = i;
            }

            // If this is a task line, add it to our items
            const taskMatch = line.match(/^>\s*-\s*\[([A-Za-z])\]/);
            if (taskMatch) {
                items.push({
                    line: line,
                    index: i,
                    time: this.extractTimeFromTask(line)
                });
            }
        }

        return {
            startIndex: headerIndex,
            endIndex: endIndex,
            items: items
        };
    }

    findMatchingTasks(lines: string[]): TaskWithTime[] {
        const tasks: TaskWithTime[] = [];
        const seenTasks = new Set<string>();

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const taskMatch = line.match(/^(>?\s*)?-\s*\[([A-Za-z])\]/);

            if (taskMatch && this.plugin.settings.taskLetters.includes(taskMatch[2].toUpperCase())) {
                // Normalize task format
                const normalizedTask = line.replace(/^>\s*/, '').trim();
                const formattedTask = `> ${normalizedTask}`;

                // Only add if we haven't seen this exact task
                if (!seenTasks.has(normalizedTask)) {
                    tasks.push({
                        line: formattedTask,
                        index: i,
                        time: this.extractTimeFromTask(line)
                    });
                    seenTasks.add(normalizedTask);
                }
            }
        }

        return tasks;
    }

    removeMatchingTasks(lines: string[], tasks: TaskWithTime[]): void {
        // Create a set of normalized task strings for comparison
        const taskStrings = new Set(tasks.map(task =>
            task.line.replace(/^>\s*/, '').trim()
        ));

        // Remove tasks from the bottom up to maintain correct indices
        for (let i = lines.length - 1; i >= 0; i--) {
            const normalizedLine = lines[i].trim().replace(/^>\s*/, '').trim();
            if (taskStrings.has(normalizedLine)) {
                lines.splice(i, 1);

                // Remove adjacent blank lines
                if (i > 0 && lines[i - 1].trim() === '') {
                    lines.splice(i - 1, 1);
                    i--;
                }
                if (i < lines.length && lines[i]?.trim() === '') {
                    lines.splice(i, 1);
                }
            }
        }
    }

    cleanupEmptyLines(lines: string[]): void {
        for (let i = lines.length - 1; i > 0; i--) {
            if (lines[i].trim() === '' && lines[i - 1].trim() === '') {
                lines.splice(i, 1);
            }
        }

        // Remove trailing empty lines
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
            lines.pop();
        }
    }

    async processFileContent(content: string): Promise<string | null> {
        // Handle YAML frontmatter
        const yamlRegex = /^---\n([\s\S]*?)\n---/;
        const yamlMatch = content.match(yamlRegex);
        const yamlFrontmatter = yamlMatch ? yamlMatch[0] : null;
        let contentWithoutYaml = yamlMatch ? content.slice(yamlMatch[0].length).trim() : content.trim();

        const lines = contentWithoutYaml.split('\n');
        const allTasks: TaskWithTime[] = [];
        let changed = false;

        // Step 1: Check if JOTS section exists and collect its items
        const existingSection = this.findJotsSection(lines);
        if (existingSection) {
            allTasks.push(...existingSection.items);
            // Remove the existing JOTS section
            lines.splice(existingSection.startIndex, existingSection.endIndex - existingSection.startIndex + 1);
            changed = true;
        }

        // Step 2: Find and collect all matching tasks from the document
        const matchingTasks = this.findMatchingTasks(lines);
        if (matchingTasks.length > 0) {
            allTasks.push(...matchingTasks);
            // Remove the original tasks
            this.removeMatchingTasks(lines, matchingTasks);
            changed = true;
        }

        if (!changed) return null;

        // Step 3: Clean up consecutive empty lines
        this.cleanupEmptyLines(lines);

        // Step 4: Build the final content
        const finalLines: string[] = [];

        // Add YAML if it existed
        if (yamlFrontmatter) {
            finalLines.push(yamlFrontmatter, '');
        }

        // Add main content
        finalLines.push(...lines);

        // Add JOTS section if we have tasks
        if (allTasks.length > 0) {
            // Add blank line before JOTS section if there's content
            if (finalLines.length > 0 && finalLines[finalLines.length - 1].trim() !== '') {
                finalLines.push('');
            }

            // Add JOTS header and sorted tasks
            finalLines.push(this.createCalloutString(this.plugin.settings.sectionFormat));
            finalLines.push(...this.sortTasks(allTasks).map(task => task.line));
        }

        return finalLines.join('\n');
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