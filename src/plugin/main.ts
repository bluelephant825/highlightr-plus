import { Editor, Menu, Notice, Plugin, PluginManifest, MarkdownView, setIcon, WorkspaceLeaf } from "obsidian";
import { wait } from "../utils/util";
import { debounce } from "../utils/debounce";
import addIcons from "../icons/customIcons";
import { HighlightrSettingTab } from "../settings/settingsTab";
import { HighlightrSettings, createDefaultHighlighterClass } from "../settings/settingsData";
import DEFAULT_SETTINGS from "../settings/settingsData";
import contextMenu from "./contextMenu";
import { createHighlighterIcons, getHighlighterPenIconId } from "../icons/customIcons";
import { createStyles } from "../utils/createStyles";
import { EnhancedApp, EnhancedEditor } from "../settings/types";
import { NotesTab, NOTES_VIEW_TYPE } from "../ui/NotesTab";

const showHighlightrMenuFromCommand = (plugin: HighlightrPlugin, editor: EnhancedEditor): void => {
    if (!editor || !editor.hasFocus()) {
        new Notice("Focus must be in editor");
        return;
    }

    const menu = new Menu();
    contextMenu(plugin.app, menu, editor, plugin, plugin.settings);

    const cursor = editor.getCursor("from");
    let coords: { right: number; top: number } | null = null;

    if (editor.cursorCoords) {
        coords = editor.cursorCoords(true, "window");
    } else if (editor.coordsAtPos) {
        const offset = editor.posToOffset(cursor);
        coords = editor.cm.coordsAtPos?.(offset) ?? editor.coordsAtPos(offset);
    }

    if (!coords) {
        return;
    }

    menu.showAtPosition({
        x: coords.right + 25,
        y: coords.top + 20,
    });
};

export default class HighlightrPlugin extends Plugin {
    app: EnhancedApp;
    editor: EnhancedEditor;
    manifest: PluginManifest;
    settings: HighlightrSettings;
    private clickHandlerBound: (e: MouseEvent) => void;
    private isUpdatingEditorContent: boolean = false;
    private suppressFullProcessingUntil: number = 0;

    private getActiveDocument(): Document {
        return this.app.workspace.activeDocument ?? document;
    }

    private getActiveEditorScroller(): HTMLElement | null {
        const activeDoc = this.getActiveDocument();
        return activeDoc.querySelector('.workspace-leaf.mod-active .cm-scroller');
    }

    private withPreservedEditorScroll(applyUpdate: () => void): void {
        const scroller = this.getActiveEditorScroller();
        const previousTop = scroller?.scrollTop ?? null;
        applyUpdate();
        if (scroller && previousTop !== null) {
            scroller.scrollTop = previousTop;
        }
    }

    async onload() {
        console.log(`Highlightr v${this.manifest.version} loaded`);
        addIcons();

        await this.loadSettings();

        // Register NotesTab view type first
        this.registerView(
            NOTES_VIEW_TYPE,
            (leaf: WorkspaceLeaf) => new NotesTab(leaf, this)
        );

        this.app.workspace.onLayoutReady(async () => {
            console.log('Initializing Highlightr plugin...');

            // Initialize plugin features
            this.reloadStyles(this.settings);
            createHighlighterIcons(this.settings, this);
            this.processMarkTags();
            this.attachEventListeners();

            // Open and initialize the notes tab
            await this.openNotesTab();

            // Force update the NotesTab after a short delay to ensure content is loaded
            window.setTimeout(() => {
                this.triggerNotesTabUpdate();
            }, 500);

            console.log('Highlightr plugin initialization complete');
        });

        this.registerEvent(
            this.app.workspace.on("editor-menu", this.handleHighlighterInContextMenu)
        );

        // Register for view changes
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", () => {
                this.removeExistingBubbles();
                this.processMarkTags();
                this.attachEventListeners();
                this.triggerNotesTabUpdate();
            })
        );

        this.registerEvent(
            this.app.workspace.on("editor-change", debounce(() => {
                if (this.isUpdatingEditorContent) return;
                if (Date.now() < this.suppressFullProcessingUntil) return;
                this.processMarkTags();
                this.triggerNotesTabUpdate();
            }, 120))
        );

        this.registerEvent(
            this.app.workspace.on("file-open", () => {
                if (this.fileHasHighlights()) {
                    this.openNotesTab();
                }
                this.triggerNotesTabUpdate();
            })
        );

        this.addSettingTab(new HighlightrSettingTab(this.app, this));

        this.addCommand({
            id: "highlighter-plugin-menu",
            name: "Open Highlightr",
            icon: "highlightr-pen",
            editorCallback: (editor: EnhancedEditor) => {
                showHighlightrMenuFromCommand(this, editor);
            },
        });

        addEventListener("Highlightr-NewCommand", () => {
            this.reloadStyles(this.settings);
            this.generateCommands(this.editor);
            createHighlighterIcons(this.settings, this);
        });

        this.generateCommands(this.editor);
        this.refresh();
    }

    reloadStyles(settings: HighlightrSettings) {
        const activeDoc = this.getActiveDocument();
        const currentSheet = activeDoc.querySelector("style#highlightr-styles");
        if (currentSheet) {
            currentSheet.remove();
        }
        createStyles(settings, activeDoc);
    }

    eraseHighlight = (editor: Editor) => {
        const currentStr = editor.getSelection();
        const newStr = currentStr
            .replace(/<mark\b[^>]*>/gi, "")
            .replace(/<\/mark\s*>/gi, "");
        editor.replaceSelection(newStr);
        editor.focus();
    };

    generateCommands(editor: Editor) {
        this.settings.highlighterOrder.forEach((highlighterKey: string) => {
            const applyCommand = (command: CommandPlot, editor: Editor) => {
                const selectedText = editor.getSelection();
                const curserStart = editor.getCursor("from");
                const curserEnd = editor.getCursor("to");
                const prefix = command.prefix;
                const suffix = command.suffix || prefix;
                const setCursor = (mode: number) => {
                    editor.setCursor(
                        curserStart.line + command.line * mode,
                        curserEnd.ch + cursorPos * mode
                    );
                };
                const cursorPos =
                    selectedText.length > 0
                        ? prefix.length + suffix.length + 1
                        : prefix.length;
                const preStart = {
                    line: curserStart.line - command.line,
                    ch: curserStart.ch - prefix.length,
                };
                const pre = editor.getRange(preStart, curserStart);

                const sufEnd = {
                    line: curserStart.line + command.line,
                    ch: curserEnd.ch + suffix.length,
                };

                const suf = editor.getRange(curserEnd, sufEnd);

                const preLast = pre.slice(-1);
                const prefixLast = prefix.trimStart().slice(-1);
                const sufFirst = suf[0];

                if (suf === suffix.trimEnd()) {
                    if (preLast === prefixLast && selectedText) {
                        editor.replaceRange(selectedText, preStart, sufEnd);
                        const changeCursor = (mode: number) => {
                            editor.setCursor(
                                curserStart.line + command.line * mode,
                                curserEnd.ch + (cursorPos * mode + 8)
                            );
                        };
                        return changeCursor(-1);
                    }
                }

                editor.replaceSelection(`${prefix}${selectedText}${suffix}`);

                return setCursor(1);
            };

            type CommandPlot = {
                char: number;
                line: number;
                prefix: string;
                suffix: string;
            };

            type commandsPlot = {
                [key: string]: CommandPlot;
            };

const colorValue = this.settings.highlighters[highlighterKey];
                const className = (this.settings.highlighterClasses?.[highlighterKey] ?? createDefaultHighlighterClass(highlighterKey)).toLowerCase();
                const commandsMap: commandsPlot = {
                highlight: {
                    char: 34,
                    line: 0,
                    prefix:
                        this.settings.highlighterMethods === "css-classes"
                            ? `<mark class="hltr-${className}" style="--hltr-color: ${colorValue};">`
                            : `<mark style="background: ${colorValue};">`,
                    suffix: "</mark>",
                },
            };

            Object.keys(commandsMap).forEach((type) => {
                let highlighterpen = getHighlighterPenIconId(
                    highlighterKey,
                    this.settings.highlighters[highlighterKey]
                );
                this.addCommand({
                    id: highlighterKey,
                    name: highlighterKey,
                    icon: highlighterpen,
                    editorCallback: async (editor: Editor) => {
                        applyCommand(commandsMap[type], editor);
                        await wait(10);
                        editor.focus();
                    },
                });
            });

            this.addCommand({
                id: "unhighlight",
                name: "Remove highlight",
                icon: "highlightr-eraser",
                editorCallback: async (editor: Editor) => {
                    this.eraseHighlight(editor);
                    editor.focus();
                },
            });
        });
    }

    refresh = () => {
        this.updateStyle();
    };

    updateStyle = () => {
        const activeDoc = this.getActiveDocument();
        activeDoc.body.classList.toggle(
            "highlightr-lowlight",
            this.settings.highlighterStyle === "lowlight"
        );
        activeDoc.body.classList.toggle(
            "highlightr-floating",
            this.settings.highlighterStyle === "floating"
        );
        activeDoc.body.classList.toggle(
            "highlightr-rounded",
            this.settings.highlighterStyle === "rounded"
        );
        activeDoc.body.classList.toggle(
            "highlightr-realistic",
            this.settings.highlighterStyle === "realistic"
        );
    };

    onunload() {
        console.log("Highlightr unloaded");
        // Clean up click listener
        if (this.clickHandlerBound) {
            this.app.workspace.containerEl.removeEventListener('click', this.clickHandlerBound);
        }
    }

    handleHighlighterInContextMenu = (
        menu: Menu,
        editor: EnhancedEditor
    ): void => {
        contextMenu(this.app, menu, editor, this, this.settings);
    };

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        this.settings.highlighterClasses = this.settings.highlighterClasses || {};
        this.settings.highlighterOrder.forEach((highlighter) => {
            const existingClass = this.settings.highlighterClasses[highlighter];
            if (!existingClass || !existingClass.trim()) {
                this.settings.highlighterClasses[highlighter] = createDefaultHighlighterClass(highlighter);
            }
        });
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    displayNoteBubble(note: string, event: MouseEvent) {
        // Remove any existing bubbles first
        this.removeExistingBubbles();

        const activeDoc = this.getActiveDocument();
        const bubble = activeDoc.createElement("div");
        bubble.className = "note-bubble";
        bubble.textContent = note;
        bubble.style.left = `${event.pageX}px`;
        bubble.style.top = `${event.pageY}px`;
        activeDoc.body.appendChild(bubble);

        // Get the mark element (highlight)
        const target = event.target as HTMLElement;
        const markElement = target.tagName.toLowerCase() === "mark" ?
            target :
            target.previousElementSibling as HTMLElement;

        const removeBubble = (e: Event) => {
            if (bubble.parentNode) {
                activeDoc.body.removeChild(bubble);
                markElement.removeEventListener("mouseout", removeBubble);
                markElement.removeEventListener("click", removeBubble);
            }
        };

        // Add listeners to mark element instead of bubble
        markElement.addEventListener("mouseout", removeBubble);
        markElement.addEventListener("click", removeBubble);
    }

    private removeExistingBubbles() {
        const activeDoc = this.getActiveDocument();
        const existingBubbles = activeDoc.querySelectorAll('.note-bubble');
        existingBubbles.forEach(bubble => {
            if (bubble.parentNode) {
                bubble.parentNode.removeChild(bubble);
            }
        });
    }

    // Attach mouse event listener to each container (editor and reading view)
    attachEventListeners() {
        const workspaceEl = this.app.workspace.containerEl;

        // Remove existing listener if present
        if (this.clickHandlerBound) {
            workspaceEl.removeEventListener('click', this.clickHandlerBound);
        }

        // Create new bound handler
        this.clickHandlerBound = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('.highlight-tag')) {
                e.stopPropagation();
                e.preventDefault();
                // Handle tag click logic here
            }
        };

        workspaceEl.addEventListener('click', this.clickHandlerBound);

        // Handle editing mode
        const activeDoc = this.getActiveDocument();
        const editorContainers = activeDoc.querySelectorAll('.cm-html-embed');
        editorContainers.forEach((editorContainer) => {
            this.attachMouseEvents(editorContainer);
        });

        // Handle reading mode
        const readingViews = activeDoc.querySelectorAll('.markdown-preview-view');
        readingViews.forEach((readingView) => {
            this.attachMouseEvents(readingView);
        });

        // Clean up any duplicate text nodes
        this.processMarkTags();
    }

    // Define mouse over event handler to display note bubble
    private attachMouseEvents(container: Element) {
        const handleMouseOver = (event: Event) => {
            const target = event.target as HTMLElement;
            if (target.tagName.toLowerCase() === "mark" && target.hasAttribute("data-note")) {
                const note = target.getAttribute("data-note");
                if (note && event instanceof MouseEvent) {
                    this.displayNoteBubble(note, event);
                }
            } else if (target.classList.contains("note-icon")) {
                const prevElement = target.previousElementSibling;
                if (prevElement?.tagName.toLowerCase() === "mark" && prevElement.hasAttribute("data-note")) {
                    const note = prevElement.getAttribute("data-note");
                    if (note && event instanceof MouseEvent) {
                        this.displayNoteBubble(note, event);
                    }
                }
            }
        };

        // Clean up and reattach
        container.removeEventListener("mouseover", handleMouseOver);
        container.addEventListener("mouseover", handleMouseOver);
    }

    private stripInjectedDecorationSpans(content: string): string {
        let cleaned = content;
        let previous = "";

        while (cleaned !== previous) {
            previous = cleaned;
            cleaned = cleaned
                .replace(/<span\s+class="note-icon"[^>]*>[\s\S]*?<\/span>/g, "")
                .replace(/<span\s+class="highlight-tag"[^>]*>[\s\S]*?<\/span>/g, "")
                .replace(/<span\s+class="highlight-tags"[^>]*>[\s\S]*?<\/span>/g, "");
        }

        return cleaned
            .replace(/<span\s+class="(?:note-icon|highlight-tag|highlight-tags)"[^>]*>/g, "")
            .replace(/(<span class="note-icon">[\s\S]*?<\/span>)(?:\s*<\/span>)+/g, "$1")
            .replace(/<\/mark>(?:\s*<\/span>)+/g, "</mark>")
            .replace(/(?:\s*<\/span>\s*)+(?=<mark\b)/g, "")
            .replace(/(^|\n)\s*(?:<\/span>\s*)+(?=\n|$)/g, "$1");
    }

    cleanupNotes() {
        try {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view?.editor) return;

            const content = view.editor.getValue();
            if (!content) return;

            const cursorPos = view.editor.getCursor();
            const activeDoc = this.getActiveDocument();

            const noteIconWrapper = activeDoc.createElement('span');
            noteIconWrapper.className = 'note-icon';
            setIcon(noteIconWrapper, 'sticky-note');
            const noteIconHtml = noteIconWrapper.outerHTML;

            const normalizedContent = this.stripInjectedDecorationSpans(content);

            const cleanContent = normalizedContent.replace(
                /<mark([^>]*)>([\s\S]*?)<\/mark>(?:\s*<span class="note-icon">[\s\S]*?<\/span>)*/g,
                (match, attrs, inner) => {
                    const attrsText = (attrs || "").trim();
                    const noteMatch = attrsText.match(/\bdata-note="([^"]*)"/i);
                    const hasNote = !!noteMatch && noteMatch[1].trim().length > 0;
                    const attrPart = attrsText.length > 0 ? ` ${attrsText}` : "";
                    const rebuiltMark = `<mark${attrPart}>${inner}</mark>`;
                    return hasNote ? `${rebuiltMark}${noteIconHtml}` : rebuiltMark;
                }
            );

            if (content !== cleanContent) {
                this.isUpdatingEditorContent = true;
                this.withPreservedEditorScroll(() => {
                    view.editor.setValue(cleanContent);
                    view.editor.setCursor(cursorPos);
                });
                this.isUpdatingEditorContent = false;
            }
        } catch (error) {
            this.isUpdatingEditorContent = false;
            console.error('Error in cleanupNotes:', error);
        }
    }

    suppressFullPostProcessing(durationMs: number = 400): void {
        this.suppressFullProcessingUntil = Date.now() + durationMs;
    }

    syncDecorationsNearSelection(editor?: Editor): void {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.editor) return;
        const targetEditor = editor ?? view.editor;
        const cursor = targetEditor.getCursor("from");
        const startLine = Math.max(0, cursor.line - 2);
        const endLine = Math.min(targetEditor.lastLine(), cursor.line + 2);
        const from = { line: startLine, ch: 0 };
        const to = { line: endLine, ch: targetEditor.getLine(endLine).length };
        const segment = targetEditor.getRange(from, to);

        const activeDoc = this.getActiveDocument();
        const noteIconWrapper = activeDoc.createElement('span');
        noteIconWrapper.className = 'note-icon';
        setIcon(noteIconWrapper, 'sticky-note');
        const noteIconHtml = noteIconWrapper.outerHTML;

        const cleaned = this.stripInjectedDecorationSpans(segment)
            .replace(/<span class="note-icon">[\s\S]*?<\/span>/g, '')
            .replace(/<span class="highlight-tag">[\s\S]*?<\/span>/g, '')
            .replace(/<span class="highlight-tags">\s*<\/span>/g, '')
            .replace(/<span class="highlight-tags">(?:\s*<span class="highlight-tag">[\s\S]*?<\/span>\s*)*<\/span>/g, '');

        const rebuilt = cleaned.replace(
            /<mark\b([^>]*)>([\s\S]*?)<\/mark>/g,
            (match, attributes, innerContent) => {
                const normalizedAttributes = (attributes || "").trim();
                const attrPart = normalizedAttributes.length > 0 ? ` ${normalizedAttributes}` : "";
                const dataTagsMatch = normalizedAttributes.match(/\bdata-tags="([^"]*)"/);
                const tags = dataTagsMatch ? dataTagsMatch[1] : "";
                const dataNoteMatch = normalizedAttributes.match(/\bdata-note="([^"]*)"/);
                const note = dataNoteMatch ? dataNoteMatch[1] : "";
                let additionalContent = "";

                if (note.trim().length > 0) {
                    additionalContent += noteIconHtml;
                }

                if (tags.trim().length > 0) {
                    const tagArray = tags
                        .split(',')
                        .map((tag: string) => tag.trim())
                        .filter((tag: string) => tag.length > 0)
                        .map((tag: string) => '#' + tag.replace(/\s+/g, '-'));
                    if (tagArray.length > 0) {
                        let tagsMarkup = '<span class="highlight-tags">';
                        tagArray.forEach((tag: string) => {
                            tagsMarkup += `<span class="highlight-tag">${tag}</span>`;
                        });
                        tagsMarkup += '</span>';
                        additionalContent += tagsMarkup;
                    }
                }

                return `<mark${attrPart}>${innerContent}</mark>${additionalContent}`;
            }
        );

        if (segment !== rebuilt) {
            this.isUpdatingEditorContent = true;
            this.withPreservedEditorScroll(() => {
                targetEditor.replaceRange(rebuilt, from, to);
                targetEditor.setCursor(cursor);
            });
            this.isUpdatingEditorContent = false;
        }

        this.triggerNotesTabUpdate();
    }

    private processMarkTags(): void {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.editor) return;

        const content = view.editor.getValue();
        if (!content) return;

        const cursorPos = view.editor.getCursor();

        const cleanContent = this.stripInjectedDecorationSpans(content)
            .replace(/<span class="note-icon">[\s\S]*?<\/span>/g, '')
            .replace(/<span class="highlight-tag">[\s\S]*?<\/span>/g, '')
            .replace(/<span class="highlight-tags">\s*<\/span>/g, '')
            .replace(/<span class="highlight-tags">(?:\s*<span class="highlight-tag">[\s\S]*?<\/span>\s*)*<\/span>/g, '');

        const updatedContent = cleanContent.replace(
            /<mark\b([^>]*)>([\s\S]*?)<\/mark>/g,
            (match, attributes, innerContent) => {
                const normalizedAttributes = (attributes || "").trim();
                const attrPart = normalizedAttributes.length > 0 ? ` ${normalizedAttributes}` : "";
                const dataTagsMatch = normalizedAttributes.match(/\bdata-tags="([^"]*)"/);
                const tags = dataTagsMatch ? dataTagsMatch[1] : "";
                const dataNoteMatch = normalizedAttributes.match(/\bdata-note="([^"]*)"/);
                const note = dataNoteMatch ? dataNoteMatch[1] : "";
                let additionalContent = "";

                if (note.trim().length > 0) {
                    const activeDoc = this.getActiveDocument();
                    const noteIconWrapper = activeDoc.createElement('span');
                    noteIconWrapper.className = 'note-icon';
                    setIcon(noteIconWrapper, 'sticky-note');
                    additionalContent += noteIconWrapper.outerHTML;
                }

                if (tags.trim().length > 0) {
                    const tagArray = tags
                        .split(',')
                        .map((tag: string) => tag.trim())
                        .filter((tag: string) => tag.length > 0)
                        .map((tag: string) => '#' + tag.replace(/\s+/g, '-'));
                    if (tagArray.length > 0) {
                        let tagsMarkup = '<span class="highlight-tags">';
                        tagArray.forEach((tag: string) => {
                            tagsMarkup += `<span class="highlight-tag">${tag}</span>`;
                        });
                        tagsMarkup += '</span>';
                        additionalContent += tagsMarkup;
                    }
                }

                return `<mark${attrPart}>${innerContent}</mark>${additionalContent}`;
            }
        );

        if (content !== updatedContent) {
            this.isUpdatingEditorContent = true;
            this.withPreservedEditorScroll(() => {
                view.editor.setValue(updatedContent);
                view.editor.setCursor(cursorPos);
            });
            this.isUpdatingEditorContent = false;
        }
    }

    private async openNotesTab(): Promise<void> {
        try {
            const run = async () => {
                const existingLeaves = this.app.workspace.getLeavesOfType(NOTES_VIEW_TYPE);
                let leaf: WorkspaceLeaf | null = null;

                if (existingLeaves.length > 0) {
                    leaf = existingLeaves[0];
                } else {
                    const rightSidebar = this.app.workspace.getRightLeaf(false);
                    leaf = rightSidebar ?? this.app.workspace.getLeaf(true);
                    await leaf.setViewState({
                        type: NOTES_VIEW_TYPE,
                        active: true,
                        state: {}
                    });
                }

                if (leaf) {
                    this.app.workspace.revealLeaf(leaf);
                    const workspace = this.app.workspace as {
                        rightSplit?: {
                            collapsed?: boolean;
                            expand?: () => void;
                        };
                    };
                    const rightSplit = workspace.rightSplit;
                    if (rightSplit?.collapsed && typeof rightSplit.expand === "function") {
                        rightSplit.expand();
                    }
                }
            };

            const workspace = this.app.workspace as {
                layoutReady?: boolean;
            };
            if (workspace.layoutReady) {
                await run();
            } else {
                this.app.workspace.onLayoutReady(run);
            }
        } catch (error) {
            console.error('Error opening notes tab:', error);
        }
    }

    private fileHasHighlights(): boolean {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const content = view?.editor?.getValue();
        if (!content) return false;
        return /<mark\b/i.test(content);
    }

    private triggerNotesTabUpdate(): void {
        try {
            const notesLeaves = this.app.workspace.getLeavesOfType(NOTES_VIEW_TYPE);
            notesLeaves.forEach(leaf => {
                const view = leaf.view;
                if (view instanceof NotesTab) {
                    view.forceUpdate();
                }
            });
        } catch (error) {
            console.error("Error triggering NotesTab update:", error);
        }
    }
}
