import { TFile } from 'obsidian';
import type JotsPlugin from '../main';
import { addJotsToJournal } from '../commands/addJots';

// Add global type declarations so JOTS Food Tracker can access the API
declare global {
    interface Window {
        JotsAssistant?: {
            api: JotsApi;
        };
    }
}

/**
 * Public API for other plugins to interact with JOTS Assistant
 */
export class JotsApi {
    constructor(private plugin: JotsPlugin) { }

    /**
     * Check if JOTS Assistant is available
     * @returns boolean indicating if JOTS Assistant is available
     */
    static isAvailable(): boolean {
        return !!(window.JotsAssistant?.api);
    }

    /**
     * Get the JOTS Assistant API if it's available
     * @returns The JOTS Assistant API instance if available, undefined otherwise
     */
    static getApi(): JotsApi | undefined {
        return window.JotsAssistant?.api;
    }

    /**
     * Add JOTS entries to a specific journal
     * @param journalName The name of the journal to add JOTS to
     * @returns Promise that resolves when the operation is complete
     */
    async addJotsToJournal(journalName: string): Promise<void> {
        console.debug('JOTS Assistant API: addJotsToJournal called with:', journalName);
        console.debug('JOTS Assistant API: Settings:', {
            rootFolder: this.plugin.settings.journalRootFolder,
            folderPattern: this.plugin.settings.journalFolderPattern,
            filePattern: this.plugin.settings.journalFilePattern
        });

        // Find the journal file
        const files = this.plugin.app.vault.getMarkdownFiles();
        console.debug('JOTS Assistant API: Looking for files with basename:', journalName);
        console.debug('JOTS Assistant API: Available files:', files.map(f => ({
            path: f.path,
            basename: f.basename,
            matches: f.basename === journalName
        })));

        const journalFile = files.find(file => file.basename === journalName);
        console.debug('JOTS Assistant API: Found journal file:', journalFile);

        if (!journalFile) {
            console.error('JOTS Assistant API: Journal not found:', journalName);
            throw new Error(`Journal "${journalName}" not found`);
        }

        console.debug('JOTS Assistant API: Processing journal file...');
        await addJotsToJournal(this.plugin, journalFile);
    }

    /**
     * Get the plugin's settings
     * @returns The current plugin settings
     */
    getSettings() {
        return this.plugin.settings;
    }
}
