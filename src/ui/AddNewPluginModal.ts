import { App, ButtonComponent, Modal, Setting, TextComponent } from 'obsidian';
import { PluginManager } from '../plugin-manager';
import JotsPlugin from '../main';

export class AddNewPluginModal extends Modal {
    private address: string = '';
    private plugin: JotsPlugin;
    private pluginManager: PluginManager;
    private enableAfterInstall: boolean;
    private repositoryAddressEl: TextComponent | null = null;
    private addPluginButton: ButtonComponent | null = null;
    private cancelButton: ButtonComponent | null = null;

    constructor(
        app: App,
        plugin: JotsPlugin,
        pluginManager: PluginManager,
        existingRepo = ''
    ) {
        super(app);
        this.plugin = plugin;
        this.pluginManager = pluginManager;
        this.address = existingRepo;
        this.enableAfterInstall = plugin.settings.enableAfterInstall;
    }

    onOpen(): void {
        const { contentEl } = this;

        const heading = contentEl.createEl("h4");
        heading.setText("GitHub repository for plugin:");

        contentEl.createEl("form", {}, (formEl) => {
            formEl.addClass("jots-modal");

            new Setting(formEl)
                .addText((addressEl) => {
                    this.repositoryAddressEl = addressEl;
                    addressEl
                        .setPlaceholder("Repository (example: username/repository)")
                        .setValue(this.address)
                        .onChange(async (value) => {
                            this.address = value.trim();
                            this.addPluginButton?.setDisabled(!this.validateGitHubRepo(this.address));
                        });
                });

            // Enable after install checkbox
            new Setting(formEl)
                .addToggle((toggle) => {
                    toggle
                        .setValue(this.enableAfterInstall)
                        .onChange((value) => {
                            this.enableAfterInstall = value;
                        });
                })
                .setName('Enable after installing')
                .setDesc('Automatically enable the plugin after installation');

            // Buttons
            formEl.createDiv("modal-button-container", (buttonContainerEl) => {
                this.cancelButton = new ButtonComponent(buttonContainerEl)
                    .setButtonText("Cancel")
                    .onClick(() => this.close());

                this.addPluginButton = new ButtonComponent(buttonContainerEl)
                    .setButtonText(this.address ? "Update" : "Add")
                    .setCta()
                    .onClick(async () => {
                        this.addPluginButton?.setDisabled(true);
                        this.cancelButton?.setDisabled(true);
                        await this.submitForm();
                    });

                if (!this.address) {
                    this.addPluginButton.setDisabled(true);
                }
            });
        });
    } async submitForm(): Promise<void> {
        if (!this.address) return;

        try {
            this.addPluginButton?.setButtonText("Installing...");
            const result = await this.pluginManager.addPlugin(
                this.address,
                "latest",
                this.enableAfterInstall
            );

            if (result) {
                this.close();
            }
        } catch (error) {
            console.error('Failed to add plugin:', error);
            // Let the error notification from plugin-manager handle the user message
        } finally {
            this.addPluginButton?.setButtonText(this.address ? "Update" : "Add");
            this.addPluginButton?.setDisabled(false);
            this.cancelButton?.setDisabled(false);
        }
    } private validateGitHubRepo(repo: string): boolean {
        // Match either format:
        // 1. user/repo
        // 2. https://github.com/user/repo
        const githubPattern = /^(?:https?:\/\/github\.com\/)?([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)(?:\.git)?$/i;
        const url = repo.trim();
        const match = githubPattern.exec(url);

        if (match) {
            // Store just the owner/repo part
            this.address = `${match[1]}/${match[2]}`;
            return true;
        }
        return false;
    }
}
