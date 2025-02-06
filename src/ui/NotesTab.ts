import { ItemView, WorkspaceLeaf, MarkdownView } from "obsidian";
import HighlightrPlugin from "../plugin/main";
import * as path from 'path';

export const NOTES_VIEW_TYPE = "highlightr-notes-view";

export class NotesTab extends ItemView {
    plugin: HighlightrPlugin;

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
        try {
            console.log("Starting updateNotesList");
            container.empty();

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

            const allHighlights: Array<{ text: string; note: string | null; color: string | null; tags: string[]; filePath: string }> = [];

            // Process each markdown leaf
            for (const leaf of markdownLeaves) {
                const view = leaf.view;
                if (view instanceof MarkdownView && view.file) {
                    console.log("Processing file:", view.file.path);
                    const content = await this.app.vault.read(view.file);
                    console.log("File content loaded:", content.length);

                    // Updated regex patterns
                    const noteRegex = /data-note="([^"]*)"/;
                    const tagsRegex = /data-tags="([^"]*)"/;
                    const colorRegex = /background(?:-color)?:\s*((?:rgb\([^)]+\)|#[A-Fa-f0-9]+))/;
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

                        allHighlights.push({
                            text,
                            note,
                            color,
                            tags,
                            filePath: view.file.path
                        });
                    }
                }
            }

            this.displayHighlights(container, allHighlights);

        } catch (error) {
            console.error("Error in updateNotesList:", error);
            container.createEl('div', {
                cls: 'highlightr-error',
                text: 'Error processing markdown content'
            });
        }
    }

    private displayHighlights(
        container: HTMLDivElement,
        highlights: Array<{ text: string; note: string | null; color: string | null; tags: string[]; filePath: string }>
    ): void {
        if (highlights.length === 0) {
            container.createDiv({
                cls: 'highlightr-message',
                text: "No highlights found"
            });
            return;
        }

        const existingFormattedContent = container.querySelector('.highlightr-formatted-content');
        if (existingFormattedContent) {
            existingFormattedContent.remove();
        }

        const formattedContent = container.createDiv({ cls: "highlightr-formatted-content" });

        // Group highlights by file
        const highlightsByFile = highlights.reduce((acc, highlight) => {
            if (!acc[highlight.filePath]) {
                acc[highlight.filePath] = [];
            }
            acc[highlight.filePath].push(highlight);
            return acc;
        }, {} as Record<string, typeof highlights>);

        // Display highlights grouped by file
        Object.entries(highlightsByFile).forEach(([filePath, fileHighlights]) => {
            const parsedPath = path.parse(filePath);
            const fileNameWithoutExtension = parsedPath.name;
            const fileSection = formattedContent.createDiv({ cls: "file-section" });
            //fileSection.createEl("h3", { text: filePath });
            fileSection.createEl("h3", { text: "Highlights & Notes" });
            fileSection.createEl("h4", { text: fileNameWithoutExtension });

            fileHighlights.forEach(({ text, note, color, tags }) => {
                const highlightEl = fileSection.createDiv({ cls: "highlight-item" });

                // Create highlight text with background color
                const textEl = highlightEl.createDiv({ cls: "highlight-text" });
                if (color) {
                    textEl.style.background = color;
                }
                textEl.createSpan({ text: `${text}` });

                // Create note if exists
                if (note) {
                    highlightEl.createDiv({
                        cls: "highlight-note",
                        text: `📝 ${note}`
                    });
                }

                // Create tags if exist
                if (tags.length > 0) {
                    const tagsContainer = highlightEl.createDiv({
                        cls: "highlight-tags"
                    });
                    tags.forEach(tag => {
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
            const container = this.containerEl.createDiv({ cls: "highlightr-notes-container" });

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
