import { App } from 'obsidian';
import { AddJotsCommand } from './addJots';
import { AddJotsRangeCommand } from './addJotsRange';
import { RefreshHeadersFootersCommand } from './refreshHeadersFooters';
import { JotsSettings } from '../settings';
import JotsPlugin from '../main';

export const commands = {
    AddJotsCommand,
    AddJotsRangeCommand,
    RefreshHeadersFootersCommand
};

export function registerCommands(plugin: JotsPlugin) {
    const addJotsCommand = new AddJotsCommand(plugin);
    const addJotsRangeCommand = new AddJotsRangeCommand(plugin.app, plugin.settings, addJotsCommand);
    const refreshHeadersFootersCommand = new RefreshHeadersFootersCommand(plugin);

    plugin.addCommand(addJotsCommand);
    plugin.addCommand(addJotsRangeCommand);
    plugin.addCommand(refreshHeadersFootersCommand);
}