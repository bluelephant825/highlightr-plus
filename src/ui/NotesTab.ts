import { ItemView, WorkspaceLeaf, MarkdownView, setIcon } from "obsidian";
import HighlightrPlugin from "../plugin/main";

export const NOTES_VIEW_TYPE = "highlightr-notes-view";

export class NotesTab extends ItemView {
    plugin: HighlightrPlugin;
    private updateRequestId = 0;

    public title = 'Highlights & Notes';

    constructor(leaf: WorkspaceLeaf, plugin: HighlightrPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return NOTES_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.title;
    }

    getIcon(): string {
        return "sticky-note"; // Uses a sticky-note icon
    }

    private async updateNotesList(container: HTMLDivElement): Promise<void> {
        const requestId = ++this.updateRequestId;
        try {
            console.log("Starting updateNotesList");
            container.empty();

            const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
            const activeFilePath = activeMarkdownView?.file?.path;

            // Get all markdown leaves
            const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
            console.log("Markdown leaves found:", markdownLeaves.length);

            if (markdownLeaves.length === 0) {
                container.createEl('div', {
                    cls: 'highlightr-message',
                    text: 'No markdown files open'
                });
                return;
            }

            const allHighlights: Array<{ text: string; note: string | null; color: string | null; tags: string[]; filePath: string; cssClass: string | null }> = [];

            // Process each markdown leaf
            for (const leaf of markdownLeaves) {
                if (requestId !== this.updateRequestId) {
                    return;
                }
                const view = leaf.view;
                if (view instanceof MarkdownView && view.file) {
                    console.log("Processing file:", view.file.path);
                    const content = view.editor?.getValue() ?? await this.app.vault.read(view.file);
                    console.log("File content loaded:", content.length);

                    // Updated regex patterns
                    const noteRegex = /data-note="([^"]*)"/;
                    const tagsRegex = /data-tags="([^"]*)"/;
                    const colorRegex = /background(?:-color)?:\s*((?:rgb\([^)]+\)|#[A-Fa-f0-9]+))/;
                    const classRegex = /\bclass="([^"]*)"/i;
                    const highlightRegex = /<mark[^>]*>(.*?)<\/mark>/g;

                    let match;
                    while ((match = highlightRegex.exec(content)) !== null) {
                        const fullMatch = match[0];
                        const text = match[1];
                        console.log("Processing mark:", fullMatch);

                        // Extract note
                        const noteMatch = fullMatch.match(noteRegex);
                        const note = noteMatch ? noteMatch[1] : null;
                        console.log("Found note:", note);

                        // Extract tags with improved handling
                        const tagsMatch = fullMatch.match(tagsRegex);
                        const tags = Array.isArray(tagsMatch) && typeof tagsMatch[1] === 'string'
                            ? tagsMatch[1].split(',')
                                .map(tag => tag.trim())
                                .filter(tag => tag.length > 0)
                                .map(tag => `#${tag.replace(/\s+/g, '-')}`)
                            : [];
                        console.log("Found tags:", tags);

                        // Extract color
                        const colorMatch = fullMatch.match(colorRegex);
                        const color = colorMatch ? colorMatch[1] : null;
                        console.log("Found color:", color);

                        const classMatch = fullMatch.match(classRegex);
                        const classTokens = classMatch?.[1]
                            ?.split(/\s+/)
                            .map((token) => token.trim())
                            .filter((token) => token.length > 0) ?? [];
                        const cssClass = classTokens.find((token) => token.startsWith("hltr-")) ?? null;
                        console.log("Found css class:", cssClass);

                        allHighlights.push({
                            text,
                            note,
                            color,
                            tags,
                            filePath: view.file.path,
                            cssClass
                        });
                    }
                }
            }

            if (requestId !== this.updateRequestId) {
                return;
            }

            this.displayHighlights(container, allHighlights, activeFilePath);

        } catch (error) {
            console.error("Error in updateNotesList:", error);
            container.createEl('div', {
                cls: 'highlightr-error',
                text: 'Error processing markdown content'
            });
        }
    }

    private decodeHtmlEntities(text: string): string {
        const textarea = document.createElement('textarea');
        textarea.innerHTML = text;
        return textarea.value;
    }

    private appendSanitized(node: Node, target: HTMLElement): void {
        if (node.nodeType === Node.TEXT_NODE) {
            target.appendChild(document.createTextNode(node.textContent ?? ''));
            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return;
        }

        const element = node as HTMLElement;
        const tagName = element.tagName.toLowerCase();

        if (tagName === 'sub' || tagName === 'sup') {
            const safeElement = document.createElement(tagName);
            Array.from(element.childNodes).forEach((child) => this.appendSanitized(child, safeElement));
            target.appendChild(safeElement);
            return;
        }

        Array.from(element.childNodes).forEach((child) => this.appendSanitized(child, target));
    }

    private renderHighlightText(container: HTMLElement, text: string): void {
        const template = document.createElement('template');
        template.innerHTML = text;
        Array.from(template.content.childNodes).forEach((node) => this.appendSanitized(node, container));
    }

    private renderNoteText(container: HTMLElement, text: string): void {
        const decodedText = this.decodeHtmlEntities(text);
        const lines = decodedText.split(/\r?\n/);
        let index = 0;

        while (index < lines.length) {
            const line = lines[index].trim();
            if (!line) {
                index += 1;
                continue;
            }

            const bulletMatch = line.match(/^[-*+]\s+(.+)$/);
            const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/);

            if (bulletMatch || numberedMatch) {
                const listEl = document.createElement(numberedMatch ? 'ol' : 'ul');

                while (index < lines.length) {
                    const currentLine = lines[index].trim();
                    if (!currentLine) {
                        index += 1;
                        continue;
                    }

                    const currentBulletMatch = currentLine.match(/^[-*+]\s+(.+)$/);
                    const currentNumberedMatch = currentLine.match(/^\d+[.)]\s+(.+)$/);

                    if (numberedMatch && currentNumberedMatch) {
                        const listItem = document.createElement('li');
                        this.renderHighlightText(listItem, currentNumberedMatch[1]);
                        listEl.appendChild(listItem);
                        index += 1;
                        continue;
                    }

                    if (bulletMatch && currentBulletMatch) {
                        const listItem = document.createElement('li');
                        this.renderHighlightText(listItem, currentBulletMatch[1]);
                        listEl.appendChild(listItem);
                        index += 1;
                        continue;
                    }

                    break;
                }

                container.appendChild(listEl);
                continue;
            }

            const lineEl = document.createElement('div');
            this.renderHighlightText(lineEl, line);
            container.appendChild(lineEl);
            index += 1;
        }
    }

    private displayHighlights(
        container: HTMLDivElement,
        highlights: Array<{ text: string; note: string | null; color: string | null; tags: string[]; filePath: string; cssClass: string | null }>,
        activeFilePath?: string
    ): void {
        const existingFormattedContent = container.querySelector('.highlightr-formatted-content');
        if (existingFormattedContent) {
            existingFormattedContent.remove();
        }

        const formattedContent = container.createDiv({ cls: "highlightr-formatted-content" });

        const sectionFilePath = activeFilePath ?? highlights[0]?.filePath;
        if (!sectionFilePath) {
            container.createDiv({
                cls: 'highlightr-message highlightr-empty-state',
                text: "No highlights found"
            });
            return;
        }

        const fileNameWithExtension = sectionFilePath.split('/').pop() || sectionFilePath;
        const fileNameWithoutExtension = fileNameWithExtension.replace(/\.[^/.]+$/, "");
        const fileSection = formattedContent.createDiv({ cls: "file-section" });
        fileSection.createEl("h3", { text: "Highlights & Notes" });
        fileSection.createEl("h4", { text: fileNameWithoutExtension });

        const fileHighlights = highlights.filter(highlight => highlight.filePath === sectionFilePath);
        if (fileHighlights.length === 0) {
            fileSection.createDiv({
                cls: 'highlightr-message highlightr-empty-state',
                text: "No highlights found"
            });
            return;
        }

        fileHighlights.forEach(({ text, note, color, tags, cssClass }: { text: string; note: string | null; color: string | null; tags: string[]; filePath: string; cssClass: string | null }) => {
            const highlightEl = fileSection.createDiv({ cls: "highlight-item" });

            const textEl = highlightEl.createDiv({ cls: "highlight-text" });
            if (color) {
                textEl.style.background = color;
            } else if (cssClass) {
                textEl.addClass(cssClass);
            }
            this.renderHighlightText(textEl, text);

            // Create note if exists
            if (note) {
                const noteEl = highlightEl.createDiv({
                    cls: "highlight-note"
                });
                const noteIconEl = noteEl.createSpan({ cls: "note-icon" });
                setIcon(noteIconEl, "sticky-note");
                const noteContentEl = noteEl.createDiv({ cls: "highlight-note-content" });
                this.renderNoteText(noteContentEl, note);
            }

            // Create tags if exist
            if (tags.length > 0) {
                const tagsContainer = highlightEl.createDiv({
                    cls: "highlight-tags"
                });
                tags.forEach((tag: string) => {
                    const tagEl = tagsContainer.createSpan({
                        cls: "highlight-tag",
                        text: tag
                    });
                    // Add click event to filter by tag (optional feature)
                    tagEl.addEventListener('click', () => {
                        // Implement tag filtering if desired
                    });
                });
            }
        });
    }

    // Enhanced force update method
    public forceUpdate(): void {
        try {
            const container = this.containerEl.querySelector('.highlightr-notes-container');
            if (container instanceof HTMLDivElement) {
                this.updateNotesList(container);
            } else {
                // If container doesn't exist, create it
                const newContainer = this.containerEl.createDiv({
                    cls: "highlightr-notes-container"
                });
                this.updateNotesList(newContainer);
            }
        } catch (error) {
            console.error("Error in forceUpdate:", error);
        }
    }

    async onClose(): Promise<void> {
        // Cleanup logic
    }

    async onOpen(): Promise<void> {
        try {
            const existingContainer = this.containerEl.querySelector('.highlightr-notes-container');
            const container = existingContainer instanceof HTMLDivElement
                ? existingContainer
                : this.containerEl.createDiv({ cls: "highlightr-notes-container" });

            // Register for workspace events
            this.registerEvent(
                this.app.workspace.on("file-open", () => {
                    this.updateNotesList(container);
                })
            );

            this.registerEvent(
                this.app.workspace.on("editor-change", () => {
                    this.updateNotesList(container);
                })
            );

            // Initial update
            await this.updateNotesList(container);
        } catch (error) {
            console.error("Error in onOpen:", error);
            this.containerEl.createDiv({
                text: "Failed to load Highlights & Notes side view",
                cls: "highlightr-error-message"
            });
        }
    }
}
