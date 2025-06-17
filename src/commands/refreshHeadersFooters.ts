import { Command } from 'obsidian';
import JotsPlugin from '../main';

export class RefreshHeadersFootersCommand implements Command {
    id = 'refresh-headers-footers';
    name = 'Refresh headers and footers';

    constructor(private plugin: JotsPlugin) { } callback = () => {
        this.plugin.refreshAllViews();
    };
}
