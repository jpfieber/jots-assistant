import { AbstractInputSuggest, App } from 'obsidian';

/**
 * A suggestion provider for input fields, offering autocompletion from a given set of strings.
 */
export class MultiSuggest extends AbstractInputSuggest<string> {
    constructor(
        private inputEl: HTMLInputElement,
        private content: Set<string>,
        private onSelectCb: (value: string) => void,
        app: App
    ) {
        super(app, inputEl);
    }

    getSuggestions(inputStr: string): string[] {
        const lowerCaseInputStr = inputStr.toLocaleLowerCase();
        return [...this.content].filter((contentItem) =>
            contentItem.toLocaleLowerCase().includes(lowerCaseInputStr)
        );
    }

    renderSuggestion(content: string, el: HTMLElement): void {
        el.setText(content);
    }

    selectSuggestion(content: string, _evt: MouseEvent | KeyboardEvent): void {
        this.onSelectCb(content);
        this.inputEl.value = content;
        this.inputEl.blur();
        this.close();
    }
}
