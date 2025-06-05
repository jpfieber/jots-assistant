import { Notice, Plugin, PluginManifest, requestUrl } from 'obsidian';
import { AddNewPluginModal } from './ui/AddNewPluginModal';
import JotsPlugin from './main';

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

    showAddPluginModal(existingRepo = ''): void {
        new AddNewPluginModal(
            this.plugin.app,
            this.plugin,
            this,
            existingRepo
        ).open();
    }

    async addPlugin(
        repositoryPath: string,
        version = '',
        enableAfterInstall = true,
        privateApiKey?: string
    ): Promise<boolean> {
        try {
            const scrubbedPath = this.scrubRepositoryUrl(repositoryPath);

            // Validate repository and get manifest
            const manifest = await this.validateRepository(scrubbedPath, version, privateApiKey);
            if (!manifest) {
                return false;
            }

            // Get release files
            const releaseFiles = await this.getReleaseFiles(scrubbedPath, manifest, version, privateApiKey);
            if (!releaseFiles) {
                return false;
            }

            // Write files to plugin folder
            await this.writePluginFiles(manifest.id, releaseFiles);

            // Update settings
            if (!this.plugin.settings.pluginList.includes(scrubbedPath)) {
                this.plugin.settings.pluginList.push(scrubbedPath);
            }

            const versionInfo = {
                repo: scrubbedPath,
                version: version || 'latest',
                token: privateApiKey
            };

            const existingIndex = this.plugin.settings.pluginVersions.findIndex(
                p => p.repo === scrubbedPath
            );

            if (existingIndex >= 0) {
                this.plugin.settings.pluginVersions[existingIndex] = versionInfo;
            } else {
                this.plugin.settings.pluginVersions.push(versionInfo);
            }

            await this.plugin.saveSettings();

            // Enable plugin if requested
            if (enableAfterInstall) {
                await this.enablePlugin(manifest.id);
            }

            new Notice(`Plugin ${manifest.name} has been ${version ? 'updated' : 'installed'}`);
            return true;

        } catch (error) {
            console.error('Error adding plugin:', error);
            new Notice(`Failed to ${version ? 'update' : 'install'} plugin: ${error.message}`);
            return false;
        }
    }

    async updatePlugin(repositoryPath: string): Promise<boolean> {
        const pluginVersion = this.plugin.settings.pluginVersions.find(
            p => p.repo === repositoryPath
        );

        // Don't update if version is frozen
        if (pluginVersion && pluginVersion.version !== 'latest') {
            new Notice(`Plugin ${repositoryPath} is on frozen version ${pluginVersion.version}`);
            return false;
        }

        // Call addPlugin with empty version to get latest, but don't enable after update
        return await this.addPlugin(
            repositoryPath,
            '',  // empty version to get latest
            false,  // don't enable after update since it's already enabled
            pluginVersion?.token  // preserve any private token
        );
    }

    private async validateRepository(
        repositoryPath: string,
        version = '',
        privateApiKey?: string
    ): Promise<PluginManifest | null> {
        try {
            const headers: Record<string, string> = {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'jots-assistant'
            };

            if (privateApiKey || this.plugin.settings.personalAccessToken) {
                headers['Authorization'] = `Token ${privateApiKey || this.plugin.settings.personalAccessToken}`;
            }

            // Get the latest release or specific version
            const release = await this.getRelease(repositoryPath, version, headers);
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

            // Optional: Replace manifest version with release tag version if they differ
            const releaseVersion = this.coerceSemver(release.tag_name);
            const manifestVersion = this.coerceSemver(manifest.version);
            if (releaseVersion && manifestVersion && releaseVersion !== manifestVersion) {
                console.log(`Version mismatch - Release: ${releaseVersion}, Manifest: ${manifestVersion}`);
                manifest.version = releaseVersion;
            }

            return manifest;

        } catch (error) {
            console.error('Error validating repository:', error);

            // Handle specific error cases
            if (error.status === 404) {
                new Notice('Repository or release not found. Check that the repository exists and has releases.');
            } else if (error.status === 403) {
                new Notice('GitHub API rate limit exceeded. Consider adding a personal access token in settings.');
            } else if (error.status === 401) {
                new Notice('Invalid GitHub personal access token.');
            } else {
                new Notice(`Failed to validate repository: ${error.message}`);
            }

            return null;
        }
    } private async getRelease(
        repositoryPath: string,
        version: string,
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
            const apiUrl = version && version !== 'latest' ?
                `https://api.github.com/repos/${repositoryPath}/releases/tags/${version}` :
                `https://api.github.com/repos/${repositoryPath}/releases?per_page=100`;

            const response = await requestUrl({
                url: apiUrl,
                headers
            });

            if (response.text === "404: Not Found") {
                return null;
            }

            let releases: any[];
            try {
                if (version && version !== 'latest') {
                    const data = JSON.parse(response.text);
                    if (!data.assets || !data.tag_name) {
                        console.log('Invalid release format');
                        return null;
                    }
                    releases = [data];
                } else {
                    const data = JSON.parse(response.text);
                    if (!Array.isArray(data)) {
                        console.log('Expected array of releases');
                        return null;
                    }
                    releases = data;
                }
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
    } private coerceSemver(version: string): string | null {
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
    } private async fetchReleaseFile(release: Release, fileName: string, headers: Record<string, string>): Promise<string | null> {
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
        manifest: PluginManifest,
        version: string,
        privateApiKey?: string
    ): Promise<ReleaseFiles | null> {
        try {
            const headers: Record<string, string> = {
                'Accept': 'application/vnd.github.v3+json'
            };

            if (privateApiKey || this.plugin.settings.personalAccessToken) {
                headers['Authorization'] = `Token ${privateApiKey || this.plugin.settings.personalAccessToken}`;
            }

            const release = await this.getRelease(repositoryPath, version, headers);
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
    }

    private async enablePlugin(pluginId: string): Promise<void> {
        try {
            // @ts-ignore - Access internal plugin API
            await this.plugin.app.plugins.loadManifest(pluginId);
            // @ts-ignore - Access internal plugin API
            await this.plugin.app.plugins.enablePlugin(pluginId);
        } catch (error) {
            console.error('Error enabling plugin:', error);
            new Notice(`Failed to enable plugin: ${error.message}`);
            throw error;
        }
    }
}
