import { App } from 'obsidian';

export type JotsSectionFormat = 'Plain' | 'Foldable-Open' | 'Foldable-Closed';

export interface InternalPlugins {
    manifests: { [key: string]: any };
    plugins: { [key: string]: any };
    enablePluginAndSave: (id: string) => Promise<void>;
    disablePluginAndSave: (id: string) => Promise<void>;
}

export interface ExtendedApp extends App {
    plugins: InternalPlugins;
    setting: {
        openTabById: (id: string) => Promise<void>;
    };
}

export interface DependencyState {
    isInstalled: boolean;
    isEnabled: boolean;
}

export interface JotsPluginInfo {
    repo: string;
    name: string;
    description: string;
}

export interface JotsSettings {
    sectionName: string;
    sectionIcon: string;
    sectionFormat: JotsSectionFormat;
    labelColor: string;
    taskLetters: string[];
    journalRootFolder: string;
    journalFolderPattern: string;
    journalFilePattern: string;
    personalAccessToken?: string; // GitHub personal access token for rate limits
    updateAtStartup: boolean; // Whether to auto-update plugins at startup
    rules: Rule[]; // Virtual Footer rules
    refreshOnFileOpen?: boolean; // Whether to refresh headers/footers on file open
    events: Event[]; // Birthday and anniversary events
    eventTaskLetter: string; // Global task letter for all events
    eventEmoji: string; // Global emoji for all events
}

export interface SettingsTab {
    id: string;
    name: string;
    content: HTMLElement;
}

// --- Virtual Footer Types ---
export enum RuleType {
    Folder = 'folder',
    Tag = 'tag',
    Property = 'property',
}

export enum ContentSource {
    Text = 'text',
    File = 'file'
}

export enum RenderLocation {
    Footer = 'footer',
    Header = 'header',
}

// --- Events Types ---
export enum EventType {
    Birthday = 'Birthday',
    Wedding = 'Wedding',
    Anniversary = 'Anniversary',
    Other = 'Other'
}

export interface Event {
    id: string;
    name: string;
    date: string; // YYYY-MM-DD format
    eventType: EventType;
    enabled: boolean;
}

export interface Rule {
    name?: string;
    enabled?: boolean;
    type: RuleType;
    path?: string;
    tag?: string;
    recursive?: boolean;
    includeSubtags?: boolean;
    propertyName?: string;
    propertyValue?: string;
    contentSource: ContentSource;
    footerText: string;
    footerFilePath?: string;
    renderLocation: RenderLocation;
}
