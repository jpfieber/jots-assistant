import { Setting, App, ButtonComponent } from 'obsidian';
import type JotsPlugin from '../../main';
import { ExtendedApp, DependencyState } from '../../types';
import { JOTS_PLUGINS } from '../../constants';

export class GeneralSection {
    private dependencyState: { [key: string]: DependencyState } = {};

    constructor(private plugin: JotsPlugin, private app: App) { }

    async checkDependencies() {
        // Helper function to check plugin state
        const checkPlugin = async (id: string) => {
            const app = this.app as unknown as ExtendedApp;
            const pluginDir = `${app.vault.configDir}/plugins/${id}/`;
            const { adapter } = app.vault;

            // Check if plugin folder exists
            const isInstalled = await adapter.exists(pluginDir);

            // Check if plugin is both installed and enabled
            const isEnabled = isInstalled && app.plugins.plugins[id] !== undefined;

            this.dependencyState[id] = {
                isInstalled,
                isEnabled
            };
        };

        // Check Dataview plugin
        await checkPlugin('dataview');

        // Check JOTS plugins
        for (const plugin of JOTS_PLUGINS) {
            const id = plugin.repo.split('/')[1]; // Get plugin ID from repo
            await checkPlugin(id);
        }
    }

    async display(containerEl: HTMLElement): Promise<void> {
        await this.checkDependencies();

        // Auto-update setting
        new Setting(containerEl)
            .setName('Auto-update plugins at startup')
            .setDesc('If enabled, installed plugins will be checked for updates each time Obsidian starts')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.updateAtStartup)
                .onChange(async (value) => {
                    this.plugin.settings.updateAtStartup = value;
                    await this.plugin.saveSettings({ refreshViews: false });
                }));

        containerEl.createEl('h3', { text: 'JOTS Dependencies' });

        // Create controls for just the Dataview dependency
        await this.createDependencyControls(
            containerEl,
            'Dataview',
            'Dataview is required for many of the JOTS features to work properly. Within the Dataview settings, ensure "Enable JavaScript queries" is enabled.',
            'dataview',
            'blacksmithgu/obsidian-dataview'
        );

        // JOTS Plugins section
        containerEl.createEl('hr');
        containerEl.createEl('h3', { text: 'JOTS Plugins' });
        containerEl.createEl('p', {
            text: 'Additional plugins that extend JOTS functionality.'
        }).addClass('setting-item-description');

        // Create controls for each JOTS plugin
        for (const plugin of JOTS_PLUGINS) {
            const id = plugin.repo.split('/')[1]; // Get plugin ID from repo
            await this.createDependencyControls(
                containerEl,
                plugin.name,
                plugin.description,
                id,
                plugin.repo
            );
        }
    }

    private async createDependencyControls(
        containerEl: HTMLElement,
        name: string,
        desc: string,
        id: string,
        repo: string
    ): Promise<void> {
        const setting = new Setting(containerEl);

        // Create name as a GitHub link
        const nameFragment = document.createDocumentFragment();
        const link = nameFragment.createEl('a', {
            text: name,
            href: `https://github.com/${repo}`
        });
        link.setAttr('target', '_blank');
        setting.setName(nameFragment);

        // Description with version info
        const descFragment = document.createDocumentFragment();
        descFragment.createDiv({ text: desc });
        const versionInfo = descFragment.createDiv();
        versionInfo.style.marginTop = '8px';
        setting.setDesc(descFragment);

        // Version info will be populated asynchronously
        Promise.all([
            this.plugin.pluginManager.getInstalledVersion(id),
            this.plugin.pluginManager.getLatestVersion(repo)
        ]).then(([installedVer, latestVer]) => {
            const isInstalled = this.dependencyState[id]?.isInstalled;
            // If installed, show installed version, otherwise show latest version
            const versionNumber = isInstalled ? (installedVer || 'N/A') : (latestVer || 'N/A');
            const versionText = `Version: v${versionNumber}`;
            versionInfo.createSpan({
                text: versionText,
                cls: latestVer && installedVer && latestVer !== installedVer ? 'jots-latest-version' : ''
            });
        });

        const isInstalled = this.dependencyState[id]?.isInstalled;
        const isLoaded = (this.app as unknown as ExtendedApp).plugins?.plugins[id] !== undefined;
        const isEnabled = isInstalled && isLoaded;

        // Add settings button if plugin is enabled
        if (isEnabled) {
            setting.addButton(btn =>
                btn.setIcon('gear')
                    .setTooltip(`Open ${name} settings`)
                    .onClick(async () => {
                        // @ts-ignore - Access internal Obsidian API
                        await this.app.setting.openTabById(id);
                    })
            );
        }

        // Create the main action button (Install/Uninstall)
        setting.addButton(btn => {
            if (!isInstalled) {
                btn.setButtonText('Install')
                    .setCta()
                    .onClick(async () => {
                        btn.setButtonText('Installing...');
                        btn.setDisabled(true);
                        const success = await this.plugin.pluginManager.addPlugin(repo);
                        await this.checkDependencies();
                        const state = this.dependencyState[id];

                        if (success && state?.isInstalled) {
                            btn.setButtonText('Uninstall')
                                .removeCta()
                                .setDisabled(state.isEnabled);

                            // Add toggle since plugin is now installed
                            setting.addToggle(toggle => {
                                toggle.setValue(state.isEnabled)
                                    .setTooltip(state.isEnabled ? `Disable ${name}` : `Enable ${name}`)
                                    .onChange(async (value) => {
                                        //@ts-ignore - Access internal Obsidian API
                                        if (value) await this.app.plugins.enablePluginAndSave(id);
                                        //@ts-ignore - Access internal Obsidian API
                                        else await this.app.plugins.disablePluginAndSave(id);
                                        await this.checkDependencies();
                                        const newState = this.dependencyState[id];
                                        btn.setDisabled(newState?.isEnabled ?? false);
                                    });
                            });
                        } else {
                            btn.setButtonText('Install')
                                .setCta()
                                .setDisabled(false);
                        }
                    });
            } else {
                btn.setButtonText('Uninstall')
                    .setDisabled(isEnabled)
                    .setTooltip('Disable plugin before Uninstalling')
                    .onClick(async () => {
                        btn.setButtonText('Uninstalling...');
                        btn.setDisabled(true);
                        await this.plugin.pluginManager.uninstallPlugin(id);
                        await this.checkDependencies();
                        const state = this.dependencyState[id];

                        if (!state?.isInstalled) {
                            btn.setButtonText('Install')
                                .setCta()
                                .setDisabled(false);

                            // Remove the toggle since plugin is now uninstalled
                            setting.components = setting.components.filter(c => c instanceof Setting);
                        }
                    });

                // Add toggle for installed plugins
                setting.addToggle(toggle => {
                    toggle.setValue(isEnabled)
                        .setTooltip(isEnabled ? `Disable ${name}` : `Enable ${name}`)
                        .onChange(async (value) => {
                            //@ts-ignore - Access internal Obsidian API
                            if (value) await this.app.plugins.enablePluginAndSave(id);
                            //@ts-ignore - Access internal Obsidian API
                            else await this.app.plugins.disablePluginAndSave(id);
                            await this.checkDependencies();
                            const newState = this.dependencyState[id];
                            btn.setDisabled(newState?.isEnabled ?? false);
                        });
                });
            }
        });
    }
}
