import { Notice, TFile } from 'obsidian';
import JotsPlugin from '../main';
import { Event, EventType } from '../types';
import { addJotsToJournal } from './addJots';

export function addEventsCommand(plugin: JotsPlugin) {
    plugin.addCommand({
        id: 'insert-daily-events',
        name: 'Insert today\'s events into daily journal',
        callback: async () => {
            await insertTodaysEvents(plugin);
        }
    });
}

async function insertTodaysEvents(plugin: JotsPlugin): Promise<void> {
    // Use local date to avoid timezone issues
    const today = new Date();
    const todayString = formatDate(today);
    const todayEvents = getTodaysEvents(plugin.settings.events, today);

    console.log('JOTS Events Debug:', {
        today: todayString,
        todayMonth: today.getMonth() + 1,
        todayDate: today.getDate(),
        eventsCount: todayEvents.length,
        events: todayEvents,
        allEvents: plugin.settings.events,
        journalSettings: {
            rootFolder: plugin.settings.journalRootFolder,
            folderPattern: plugin.settings.journalFolderPattern,
            filePattern: plugin.settings.journalFilePattern
        }
    });

    if (todayEvents.length === 0) {
        new Notice('No events found for today');
        return;
    }

    // Get or create today's journal file
    const journalFile = await getOrCreateJournalFile(plugin, todayString);
    if (!journalFile) {
        new Notice('Could not create or find today\'s journal file');
        return;
    }

    console.log('JOTS Events Debug: Found journal file at', journalFile.path);

    // Read current content
    let content = await plugin.app.vault.read(journalFile);
    console.log('JOTS Events Debug: Current file content length:', content.length);

    // Generate event text
    let eventText = '';
    const taskLetter = plugin.settings.eventTaskLetter || 'e';
    const emoji = plugin.settings.eventEmoji || '🎈';
    
    for (const event of todayEvents) {
        const eventDescription = generateEventDescription(event, today);
        eventText += `- [${taskLetter}] (time:: 00:00) (type:: ${emoji}) (event:: ${eventDescription})\n`;
    }

    console.log('JOTS Events Debug: Generated event text:', eventText);

    // Check if events are already in the file
    if (content.includes(eventText.trim())) {
        new Notice('Today\'s events are already in the journal');
        return;
    }

    // Find the best place to insert events
    const insertPosition = findInsertPosition(content);
    console.log('JOTS Events Debug: Insert position:', insertPosition);
    
    // Always append to the end of the file without adding headers
    if (content.trim()) {
        // Add events at the end with a single newline separator
        content += '\n' + eventText.trim();
    } else {
        // If file is empty, just add the events
        content = eventText.trim();
    }

    console.log('JOTS Events Debug: Final content length:', content.length);

    // Write back to file
    await plugin.app.vault.modify(journalFile, content);
    
    // Call addJotsToJournal to sort and create headers if necessary
    console.log('JOTS Events Debug: Calling addJotsToJournal to sort events');
    await addJotsToJournal(plugin, journalFile);
    
    const eventCount = todayEvents.length;
    new Notice(`Added ${eventCount} event${eventCount > 1 ? 's' : ''} to today's journal`);
}

function getTodaysEvents(events: Event[], today: Date): Event[] {
    const todayMonth = String(today.getMonth() + 1).padStart(2, '0');
    const todayDate = String(today.getDate()).padStart(2, '0');
    
    console.log('JOTS Events Debug: Filtering events for', { todayMonth, todayDate });
    
    return events.filter(event => {
        if (!event.enabled) {
            console.log('JOTS Events Debug: Event disabled:', event.name);
            return false;
        }
        
        const [year, month, date] = event.date.split('-');
        const matches = month === todayMonth && date === todayDate;
        
        console.log('JOTS Events Debug: Checking event:', {
            name: event.name,
            eventDate: event.date,
            eventMonth: month,
            eventDay: date,
            todayMonth,
            todayDate,
            matches
        });
        
        return matches;
    });
}

function generateEventDescription(event: Event, today: Date): string {
    const [eventYear] = event.date.split('-');
    const currentYear = today.getFullYear();
    
    let description = '';
    let years = '';
    
    // Calculate years if not using placeholder year 1900
    if (eventYear !== '1900') {
        const yearsDiff = currentYear - parseInt(eventYear);
        years = `${yearsDiff}${getOrdinalSuffix(yearsDiff)} `;
    }
    
    // Generate description based on event type
    switch (event.eventType) {
        case EventType.Birthday:
            description = `${event.name}'s ${years}${event.eventType}`;
            break;
        case EventType.Wedding:
            description = `${event.name}'s ${years}${event.eventType} Anniversary`;
            break;
        case EventType.Anniversary:
            description = `${event.name}'s ${years}${event.eventType}`;
            break;
        default:
            description = `${event.name}'s ${years}${event.eventType}`;
    }
    
    return description;
}

function getOrdinalSuffix(num: number): string {
    const j = num % 10;
    const k = num % 100;
    
    if (j === 1 && k !== 11) {
        return 'st';
    }
    if (j === 2 && k !== 12) {
        return 'nd';
    }
    if (j === 3 && k !== 13) {
        return 'rd';
    }
    return 'th';
}

function formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function getOrCreateJournalFile(plugin: JotsPlugin, dateString: string): Promise<TFile | null> {
    // Use the existing journal pattern from settings
    const journalPattern = plugin.settings.journalFilePattern;
    const folderPattern = plugin.settings.journalFolderPattern;
    const rootFolder = plugin.settings.journalRootFolder;
    
    // Parse the date string correctly to avoid timezone issues
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day); // month is 0-based in Date constructor
    
    // Replace date placeholders in patterns
    const fileName = replaceDatePlaceholders(journalPattern, date) + '.md';
    const folderPath = rootFolder + '/' + replaceDatePlaceholders(folderPattern, date);
    const fullPath = folderPath + '/' + fileName;
    
    console.log('JOTS Events Debug: Journal path construction:', {
        dateString,
        parsedDate: date.toDateString(),
        rootFolder,
        folderPattern,
        journalPattern,
        fileName,
        folderPath,
        fullPath
    });
    
    // Check if file exists
    const existingFile = plugin.app.vault.getAbstractFileByPath(fullPath);
    if (existingFile instanceof TFile) {
        console.log('JOTS Events Debug: Found existing journal file');
        return existingFile;
    }
    
    console.log('JOTS Events Debug: Journal file not found, attempting to create');
    
    // Create folder if it doesn't exist
    try {
        await plugin.app.vault.createFolder(folderPath);
        console.log('JOTS Events Debug: Created folder:', folderPath);
    } catch (error) {
        console.log('JOTS Events Debug: Folder creation failed (might already exist):', error);
    }
    
    // Create the file
    try {
        const newFile = await plugin.app.vault.create(fullPath, '# ' + formatDate(date) + '\n\n');
        console.log('JOTS Events Debug: Created new journal file:', fullPath);
        return newFile;
    } catch (error) {
        console.error('JOTS Events Debug: Error creating journal file:', error);
        return null;
    }
}

function replaceDatePlaceholders(pattern: string, date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = dayNames[date.getDay()];
    
    return pattern
        .replace(/YYYY/g, String(year))
        .replace(/MM/g, month)
        .replace(/DD/g, day)
        .replace(/ddd/g, dayName);
}

function findInsertPosition(content: string): { found: boolean; lineIndex: number } {
    const lines = content.split('\n');
    
    // Look for existing Events section
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim().toLowerCase();
        if (line.startsWith('## events') || line.startsWith('#events')) {
            return { found: true, lineIndex: i };
        }
    }
    
    // Look for other sections where we can insert after
    const sectionHeaders = ['## tasks', '## todo', '## notes', '## journal'];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim().toLowerCase();
        for (const header of sectionHeaders) {
            if (line.startsWith(header)) {
                return { found: true, lineIndex: i };
            }
        }
    }
    
    return { found: false, lineIndex: -1 };
}
