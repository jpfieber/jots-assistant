import { Notice, PluginManifest, requestUrl } from 'obsidian';
import JotsPlugin from './main';

// Internal types for Obsidian's plugin API
interface InternalPlugins {
    manifests: { [key: string]: PluginManifest };
    plugins: { [key: string]: Plugin };
    disablePlugin: (id: string) => Promise<void>;
    enablePlugin: (id: string) => Promise<void>;
    loadManifests: () => Promise<void>;
}

interface ExtendedApp {
    plugins: InternalPlugins;
}

interface Release {
    tag_name: string;
    assets: Array<{
        name: string;
        browser_download_url: string;
        url: string;
    }>;
}

interface ReleaseFiles {
    mainJs: string | null;
    manifest: string | null;
    styles: string | null;
}

export class PluginManager {
    private plugin: JotsPlugin;

    constructor(plugin: JotsPlugin) {
        this.plugin = plugin;
    }

    private scrubRepositoryUrl(address: string): string {
        // Remove any protocol and github.com from URL if present
        let scrubbedAddress = address.replace(/https?:\/\/github\.com\//i, '');
        // Remove .git extension if present
        scrubbedAddress = scrubbedAddress.replace(/\.git$/i, '');
        // Remove any trailing slashes
        scrubbedAddress = scrubbedAddress.replace(/\/$/, '');
        // Trim whitespace
        return scrubbedAddress.trim();
    }

    async addPlugin(
        repositoryPath: string
    ): Promise<boolean> {
        try {
            const scrubbedPath = this.scrubRepositoryUrl(repositoryPath);

            // Validate repository and get manifest
            const manifest = await this.validateRepository(scrubbedPath);
            if (!manifest) {
                return false;
            }

            // Get release files
            const releaseFiles = await this.getReleaseFiles(scrubbedPath, manifest);
            if (!releaseFiles) {
                return false;
            }

            // Write files to plugin folder
            await this.writePluginFiles(manifest.id, releaseFiles);

            // Enable the plugin by default
            await this.enablePlugin(manifest.id);

            new Notice(`Plugin ${manifest.name} has been installed`);
            return true;

        } catch (error) {
            console.error('Error installing plugin:', error);
            new Notice(`Failed to install plugin: ${error.message}`);
            return false;
        }
    }

    private async validateRepository(
        repositoryPath: string
    ): Promise<PluginManifest | null> {
        try {
            const headers: Record<string, string> = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'jots-assistant'
            };

            // Get the latest release
            const release = await this.getRelease(repositoryPath, headers);
            if (!release) {
                new Notice('No release found for the repository');
                return null;
            }

            // Get manifest from release
            const manifestContent = await this.fetchReleaseFile(release, 'manifest.json', headers);
            if (!manifestContent) {
                new Notice('No manifest.json found in release');
                return null;
            }

            // Parse and validate manifest
            let manifest: PluginManifest;
            try {
                manifest = JSON.parse(manifestContent);
            } catch (error) {
                new Notice('Invalid manifest.json format');
                return null;
            }

            // Validate required fields
            if (!manifest.id || !manifest.version) {
                new Notice('Invalid manifest.json (missing id or version)');
                return null;
            }

            return manifest;

        } catch (error) {
            console.error('Error validating repository:', error);

            // Handle specific error cases
            if (error.status === 404) {
                new Notice('Repository or release not found. Check that the repository exists and has releases.');
            } else if (error.status === 403) {
                new Notice('GitHub API rate limit exceeded.');
            } else {
                new Notice(`Failed to validate repository: ${error.message}`);
            }

            return null;
        }
    }

    private async getRelease(
        repositoryPath: string,
        headers: Record<string, string>
    ): Promise<Release | null> {
        try {
            // First check if repo exists
            headers = {
                ...headers,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'jots-assistant'
            };

            try {
                await requestUrl({
                    url: `https://api.github.com/repos/${repositoryPath}`,
                    headers
                });
            } catch (error) {
                if (error.status === 404) {
                    console.log('Repository not found');
                    return null;
                }
                throw error;
            }

            // Get releases
            const apiUrl = `https://api.github.com/repos/${repositoryPath}/releases?per_page=100`;

            const response = await requestUrl({
                url: apiUrl,
                headers
            });

            if (response.text === "404: Not Found") {
                return null;
            }

            let releases: any[];
            try {
                const data = JSON.parse(response.text);
                if (!Array.isArray(data)) {
                    console.log('Expected array of releases');
                    return null;
                }
                releases = data;
            } catch (e) {
                console.log('Failed to parse releases:', e);
                return null;
            }

            // Filter for valid releases with assets
            const validReleases = releases.filter(r =>
                r.assets &&
                Array.isArray(r.assets) &&
                r.assets.length > 0 &&
                r.tag_name &&
                !r.draft
            );

            if (validReleases.length === 0) {
                console.log('No valid releases found with assets');
                return null;
            }

            // Sort by version number
            validReleases.sort((a, b) => {
                const aVer = this.coerceSemver(a.tag_name);
                const bVer = this.coerceSemver(b.tag_name);
                if (!aVer || !bVer) {
                    return b.tag_name.localeCompare(a.tag_name);
                }
                const aParts = aVer.split('.').map(Number);
                const bParts = bVer.split('.').map(Number);
                for (let i = 0; i < 3; i++) {
                    if (bParts[i] > aParts[i]) return 1;
                    if (bParts[i] < aParts[i]) return -1;
                }
                return 0;
            });

            // Return latest valid release
            return validReleases[0] as Release;

        } catch (error) {
            console.error('Error fetching release:', error);
            if (error.status === 403) {
                throw new Error('GitHub API rate limit exceeded. Try adding a personal access token in settings.');
            }
            throw error;
        }
    }

    private coerceSemver(version: string): string | null {
        // Remove 'v' prefix if present
        const cleaned = version.replace(/^v/i, '');

        // First try strict semver
        const semverRegex = /^(\d+)\.(\d+)\.(\d+)(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;
        const match = cleaned.match(semverRegex);
        if (match) {
            return `${match[1]}.${match[2]}.${match[3]}`;
        }

        // If that fails, try to extract any numbers we can find
        const numbers = cleaned.match(/\d+/g);
        if (numbers && numbers.length >= 3) {
            return `${numbers[0]}.${numbers[1]}.${numbers[2]}`;
        }

        if (numbers && numbers.length >= 2) {
            return `${numbers[0]}.${numbers[1]}.0`;
        }

        if (numbers && numbers.length === 1) {
            return `${numbers[0]}.0.0`;
        }

        return null;
    }

    private async fetchReleaseFile(release: Release, fileName: string, headers: Record<string, string>): Promise<string | null> {
        try {
            const asset = release.assets.find(a => a.name === fileName);
            if (!asset) {
                console.log(`File ${fileName} not found in release assets`);
                return null;
            }

            // Get the asset data - must use asset.url and proper Accept header
            const response = await requestUrl({
                url: asset.url,
                headers: {
                    ...headers,
                    'Accept': 'application/octet-stream',
                }
            });

            // GitHub API returns "Not Found" or {"error":"Not Found"} for missing assets
            const text = response.text;
            if (text === "Not Found" || text === `{"error":"Not Found"}`) {
                console.log(`Failed to download ${fileName}: Not found`);
                return null;
            }

            return text;

        } catch (error) {
            console.error(`Error fetching ${fileName}:`, error);
            new Notice(`Error fetching ${fileName}: ${error.message}`);
            return null;
        }
    }

    private async getReleaseFiles(
        repositoryPath: string,
        manifest: PluginManifest
    ): Promise<ReleaseFiles | null> {
        try {
            const headers: Record<string, string> = {
                'Accept': 'application/vnd.github.v3+json'
            };

            const release = await this.getRelease(repositoryPath, headers);
            if (!release) {
                return null;
            }

            // Attempt to get all required files
            const mainJs = await this.fetchReleaseFile(release, 'main.js', headers);
            if (!mainJs) {
                new Notice('Required main.js file not found in release');
                return null;
            }

            const manifestFile = await this.fetchReleaseFile(release, 'manifest.json', headers);
            if (!manifestFile) {
                new Notice('Required manifest.json file not found in release');
                return null;
            }

            // styles.css is optional
            const styles = await this.fetchReleaseFile(release, 'styles.css', headers);

            return {
                mainJs,
                manifest: manifestFile,
                styles
            };

        } catch (error) {
            console.error('Error getting release files:', error);
            new Notice(`Failed to get release files: ${error.message}`);
            return null;
        }
    }

    private async writePluginFiles(pluginId: string, files: ReleaseFiles): Promise<void> {
        const pluginDir = `${this.plugin.app.vault.configDir}/plugins/${pluginId}/`;
        const { adapter } = this.plugin.app.vault;

        // Create plugin directory if it doesn't exist
        if (!(await adapter.exists(pluginDir))) {
            await adapter.mkdir(pluginDir);
        }

        // Write main.js (required)
        if (files.mainJs) {
            await adapter.write(`${pluginDir}main.js`, files.mainJs);
        }

        // Write manifest.json (required)
        if (files.manifest) {
            await adapter.write(`${pluginDir}manifest.json`, files.manifest);
        }

        // Write styles.css (optional)
        if (files.styles) {
            await adapter.write(`${pluginDir}styles.css`, files.styles);
        }
    } private async enablePlugin(pluginId: string): Promise<void> {
        try {
            const app = this.plugin.app as unknown as ExtendedApp;

            // First load manifests to ensure we have current state
            await app.plugins.loadManifests();

            // Enable the plugin
            await app.plugins.enablePlugin(pluginId);

            // Wait a bit for the enable to take effect
            await new Promise(resolve => setTimeout(resolve, 200));

            // Force a manifest reload to ensure state is synchronized
            await app.plugins.loadManifests();

            // Update the UI state if needed
            if (this.plugin.settingTab) {
                await this.plugin.settingTab.checkDependencies();
                if (this.plugin.settingTab.containerEl.isShown()) {
                    await this.plugin.settingTab.display();
                }
            }
        } catch (error) {
            console.error('Error enabling plugin:', error);
            new Notice(`Failed to enable plugin: ${error.message}`);
            throw error;
        }
    } async uninstallPlugin(pluginId: string): Promise<boolean> {
        try {
            const app = this.plugin.app;
            const extApp = app as unknown as ExtendedApp;

            // Get plugin manifest to check if it exists
            const manifest = extApp.plugins.manifests[pluginId];
            if (!manifest) {
                new Notice(`Plugin ${pluginId} not found`);
                return false;
            }

            const pluginDir = `${app.vault.configDir}/plugins/${pluginId}/`;
            const { adapter } = app.vault;

            // First verify the plugin directory exists
            if (!await adapter.exists(pluginDir)) {
                new Notice(`Plugin directory not found: ${pluginId}`);
                return false;
            }

            // First reload manifests to ensure we have current state
            await extApp.plugins.loadManifests();

            // Then disable the plugin if it's enabled
            if (extApp.plugins.plugins[pluginId]) {
                await extApp.plugins.disablePlugin(pluginId);
                // Give a longer delay after disabling
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            try {
                // 1. First remove styles.css since it's optional and won't trigger hot-reload
                const stylesPath = `${pluginDir}styles.css`;
                if (await adapter.exists(stylesPath)) {
                    await adapter.remove(stylesPath);
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                // 2. Then remove main.js
                const mainPath = `${pluginDir}main.js`;
                if (await adapter.exists(mainPath)) {
                    await adapter.remove(mainPath);
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                // 3. Then remove manifest.json last
                const manifestPath = `${pluginDir}manifest.json`;
                if (await adapter.exists(manifestPath)) {
                    await adapter.remove(manifestPath);
                    // Wait a bit longer after manifest removal
                    await new Promise(resolve => setTimeout(resolve, 300));
                }

                // 4. Finally remove the directory after all files are gone
                if (await adapter.exists(pluginDir)) {
                    await adapter.rmdir(pluginDir, true);
                    await new Promise(resolve => setTimeout(resolve, 200));
                }

                // Force reload manifests one final time
                await extApp.plugins.loadManifests();

                // Update the UI state if needed
                if (this.plugin.settingTab) {
                    await this.plugin.settingTab.checkDependencies();
                    if (this.plugin.settingTab.containerEl.isShown()) {
                        await this.plugin.settingTab.display();
                    }
                }
            } catch (error) {
                console.error('Error removing plugin files:', error);
                // If we hit an error, force reload manifests to ensure clean state
                await extApp.plugins.loadManifests();
                throw error;
            }

            new Notice(`Plugin ${manifest.name} has been uninstalled`);
            return true;

        } catch (error) {
            console.error('Error uninstalling plugin:', error);
            new Notice(`Failed to uninstall plugin: ${error.message}`);
            return false;
        }
    }

    async installPlugin(name: string, desc: string, repo: string, pluginId: string): Promise<boolean> {
        try {
            const app = this.plugin.app;
            const pluginDir = `${app.vault.configDir}/plugins/${pluginId}/`;
            const { adapter } = app.vault;

            // Check if plugin is already installed
            if (await adapter.exists(pluginDir)) {
                new Notice(`Plugin ${name} is already installed`);
                return false;
            }

            // Create plugin directory if it doesn't exist
            try {
                await adapter.mkdir(pluginDir);
                // Wait a moment for directory creation
                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (error) {
                console.error('Error creating plugin directory:', error);
                new Notice(`Failed to create plugin directory: ${error.message}`);
                return false;
            }

            // Verify directory was created
            if (!await adapter.exists(pluginDir)) {
                new Notice('Failed to create plugin directory');
                return false;
            }

            // Download and write manifest first
            try {
                const manifestJson = {
                    id: pluginId,
                    name: name,
                    version: "1.0.0",
                    minAppVersion: "0.15.0",
                    description: desc,
                    author: "Virtual Footer",
                    authorUrl: repo,
                    isDesktopOnly: false
                };

                await adapter.write(
                    `${pluginDir}manifest.json`,
                    JSON.stringify(manifestJson, null, 2)
                );
                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (error) {
                console.error('Error writing manifest:', error);
                // Clean up directory if manifest write fails
                await adapter.rmdir(pluginDir, true);
                throw error;
            }

            // Download and write main.js
            try {
                const mainJsContent = await this.fetchGithubFile(repo, 'main.js');
                await adapter.write(`${pluginDir}main.js`, mainJsContent);
                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (error) {
                console.error('Error writing main.js:', error);
                // Clean up directory if main.js write fails
                await adapter.rmdir(pluginDir, true);
                throw error;
            }

            // Download and write styles.css if it exists
            try {
                const cssContent = await this.fetchGithubFile(repo, 'styles.css');
                if (cssContent) {
                    await adapter.write(`${pluginDir}styles.css`, cssContent);
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            } catch (error) {
                // Don't throw on styles.css error since it's optional
                console.log('Note: styles.css not found or failed to download');
            }

            // Verify all required files exist
            const mainJsExists = await adapter.exists(`${pluginDir}main.js`);
            const manifestExists = await adapter.exists(`${pluginDir}manifest.json`);

            if (!mainJsExists || !manifestExists) {
                // Clean up if verification fails
                await adapter.rmdir(pluginDir, true);
                new Notice('Failed to verify plugin files after installation');
                return false;
            }

            // Force reload manifests
            await (app as unknown as ExtendedApp).plugins.loadManifests();

            new Notice(`Plugin ${name} has been installed`);
            return true;

        } catch (error) {
            console.error('Error installing plugin:', error);
            new Notice(`Failed to install plugin: ${error.message}`);
            return false;
        }
    }

    private async fetchGithubFile(repo: string, filename: string): Promise<string> {
        try {
            const response = await fetch(`${repo}/raw/master/${filename}`);
            if (!response.ok) {
                throw new Error(`Failed to fetch ${filename}: ${response.statusText}`);
            }
            return await response.text();
        } catch (error) {
            console.error(`Error fetching ${filename}:`, error);
            throw error;
        }
    }
}
