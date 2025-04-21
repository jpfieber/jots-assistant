import { App } from 'obsidian';
import { AddJotsCommand } from './addJots';
import { AddJotsRangeCommand } from './addJotsRange';
import { JotsSettings } from '../settings';
import JotsPlugin from '../main';

export const commands = {
    AddJotsCommand,
    AddJotsRangeCommand
};

export function registerCommands(plugin: JotsPlugin) {
    const addJotsCommand = new AddJotsCommand(plugin);
    const addJotsRangeCommand = new AddJotsRangeCommand(plugin.app, plugin.settings, addJotsCommand);

    plugin.addCommand(addJotsCommand);
    plugin.addCommand(addJotsRangeCommand);
}