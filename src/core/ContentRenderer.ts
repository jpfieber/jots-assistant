import { MarkdownRenderer, WorkspaceLeaf, MarkdownView, App } from 'obsidian';
import {
    CSS_DYNAMIC_CONTENT_ELEMENT,
    CSS_HEADER_GROUP_ELEMENT,
    CSS_FOOTER_GROUP_ELEMENT,
    CSS_HEADER_RENDERED_CONTENT,
    CSS_FOOTER_RENDERED_CONTENT,
    CSS_HEADER_CONTAINER,
    CSS_FOOTER_CONTAINER,
    CSS_REMOVE_FLEX,
    SELECTOR_PREVIEW_HEADER_AREA,
    SELECTOR_PREVIEW_FOOTER_AREA
} from '../constants/dom';

export class ContentRenderer {
    constructor(
        private plugin: { app: App },
        private leaf: WorkspaceLeaf
    ) { }

    async createHeaderContent(content: string): Promise<HTMLElement> {
        const headerGroup = this.createContentGroup(CSS_HEADER_GROUP_ELEMENT);
        const renderedContent = await this.renderMarkdown(content);
        renderedContent.classList.add(CSS_HEADER_RENDERED_CONTENT);
        headerGroup.appendChild(renderedContent);
        return headerGroup;
    }

    async createFooterContent(content: string): Promise<HTMLElement> {
        const footerGroup = this.createContentGroup(CSS_FOOTER_GROUP_ELEMENT);
        const renderedContent = await this.renderMarkdown(content);
        renderedContent.classList.add(CSS_FOOTER_RENDERED_CONTENT);
        footerGroup.appendChild(renderedContent);
        return footerGroup;
    }

    private createContentGroup(className: string): HTMLElement {
        const group = document.createElement('div');
        group.classList.add(CSS_DYNAMIC_CONTENT_ELEMENT, className);
        return group;
    } private async renderMarkdown(content: string): Promise<HTMLElement> {
        const container = document.createElement('div');
        const view = this.leaf.view as MarkdownView;
        await MarkdownRenderer.renderMarkdown(
            content,
            container,
            view.file?.path || '',
            view
        );

        // Add click handlers for internal links
        container.addEventListener('click', (event) => {
            const target = event.target as HTMLElement;
            if (target.matches('a.internal-link')) {
                event.preventDefault();
                const href = target.getAttribute('href');
                if (href) {
                    this.plugin.app.workspace.openLinkText(
                        decodeURIComponent(href),
                        view.file?.path || ''
                    );
                }
            }
        });

        return container;
    } injectContent(headerContent: HTMLElement | null, footerContent: HTMLElement | null): void {
        const view = this.leaf.view as MarkdownView;
        const isPreviewMode = view.getMode() === 'preview';

        console.debug('JOTS Assistant: Injecting content -',
            'Mode:', isPreviewMode ? 'preview' : 'source',
            'Header:', !!headerContent,
            'Footer:', !!footerContent
        );

        if (isPreviewMode) {
            this.injectPreviewContent(headerContent, footerContent);
        } else {
            this.injectSourceContent(headerContent, footerContent);
        }
    } private injectPreviewContent(headerContent: HTMLElement | null, footerContent: HTMLElement | null): void {
        const container = this.leaf.view.containerEl;

        if (headerContent) {
            const headerArea = container.querySelector(SELECTOR_PREVIEW_HEADER_AREA);
            if (headerArea) {
                headerArea.appendChild(headerContent);
                console.debug('JOTS Assistant: Header injected in preview mode');
            } else {
                console.debug('JOTS Assistant: Preview header area not found');
            }
        }

        if (footerContent) {
            const footerArea = container.querySelector(SELECTOR_PREVIEW_FOOTER_AREA);
            if (footerArea) {
                footerArea.appendChild(footerContent);
                console.debug('JOTS Assistant: Footer injected in preview mode');
            } else {
                console.debug('JOTS Assistant: Preview footer area not found');
            }
        }
    } private injectSourceContent(headerContent: HTMLElement | null, footerContent: HTMLElement | null): void {
        const view = this.leaf.view as MarkdownView;
        const editor = view.editor;
        const container = this.leaf.view.containerEl;

        const cmContent = container.querySelector('.cm-content');
        if (!cmContent) {
            console.debug('JOTS Assistant: No .cm-content found for source mode injection');
            return;
        }

        const cmSizer = cmContent.parentElement;
        if (!cmSizer) {
            console.debug('JOTS Assistant: No cm-sizer found for source mode injection');
            return;
        }

        // Clean up any existing containers first
        this.cleanup();

        // Create and inject header if needed
        if (headerContent) {
            const headerContainer = document.createElement('div');
            headerContainer.className = CSS_HEADER_CONTAINER;
            headerContainer.appendChild(headerContent);
            cmSizer.insertBefore(headerContainer, cmContent);
            console.debug('JOTS Assistant: Header injected in source mode');
        }

        // Create and inject footer if needed
        if (footerContent) {
            const footerContainer = document.createElement('div');
            footerContainer.className = CSS_FOOTER_CONTAINER;
            footerContainer.appendChild(footerContent);
            cmSizer.appendChild(footerContainer);
            console.debug('JOTS Assistant: Footer injected in source mode');
        }

        // Adjust container styles for proper layout
        const cmContentContainer = container.querySelector('.cm-contentContainer');
        if (cmContentContainer) {
            cmContentContainer.classList.add(CSS_REMOVE_FLEX);
        }
    } cleanup(): void {
        console.debug('JOTS Assistant: ContentRenderer cleanup called');
        const container = this.leaf.view.containerEl;

        // Remove any existing headers/footers - be more thorough
        const elements = container.querySelectorAll(
            `.${CSS_HEADER_CONTAINER}, .${CSS_FOOTER_CONTAINER}, .${CSS_DYNAMIC_CONTENT_ELEMENT}`
        );
        console.debug('JOTS Assistant: Removing', elements.length, 'content elements');
        elements.forEach(el => el.remove());

        // Clean up styling
        const cmContentContainer = container.querySelector('.cm-contentContainer');
        if (cmContentContainer) {
            cmContentContainer.classList.remove(CSS_REMOVE_FLEX);
        }
    }
}
