import { Editor, EventRef, Menu, Notice, Plugin, PluginManifest, MarkdownView, setIcon, WorkspaceLeaf } from "obsidian";
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
    app!: EnhancedApp;
    editor!: EnhancedEditor;
    manifest!: PluginManifest;
    settings!: HighlightrSettings;
    private clickHandlerBound!: (e: MouseEvent) => void;
    private readingContextMenuHandlerBound!: (e: MouseEvent) => void;
    private editorMenuEventRef: EventRef | null = null;
    private isUpdatingEditorContent: boolean = false;
    private suppressFullProcessingUntil: number = 0;
    private isRefreshingPreviewAfterOpen: boolean = false;
    private readonly markRegex = /<mark\b[^>]*>[\s\S]*?<\/mark>/g;

    private getActiveDocument(): Document {
        return this.app.workspace.activeDocument ?? activeDocument;
    }

    private getActiveEditorScroller(): HTMLElement | null {
        const activeDoc = this.getActiveDocument();
        return activeDoc.querySelector('.workspace-leaf.mod-active .cm-scroller');
    }

    private findMarkRangeAt(line: string, offset: number): { start: number; end: number } | null {
        this.markRegex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = this.markRegex.exec(line)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            if (offset >= start && offset <= end) {
                return { start, end };
            }
        }
        return null;
    }

    private findNearestRangeByText(
        editor: EnhancedEditor,
        text: string,
        preferredOffset?: number,
    ): { from: { line: number; ch: number }; to: { line: number; ch: number } } | null {
        if (!text.length || !editor.posToOffset || !editor.offsetToPos) {
            return null;
        }

        const content = editor.getValue();
        const fallbackOffset = editor.posToOffset(editor.getCursor("from"));
        const targetOffset = preferredOffset ?? fallbackOffset;
        let matchIndex = content.indexOf(text);
        if (matchIndex === -1) {
            return null;
        }

        let closestIndex = matchIndex;
        let closestDistance = Math.abs(matchIndex - targetOffset);
        while (matchIndex !== -1) {
            const distance = Math.abs(matchIndex - targetOffset);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = matchIndex;
            }
            matchIndex = content.indexOf(text, matchIndex + 1);
        }

        return {
            from: editor.offsetToPos(closestIndex),
            to: editor.offsetToPos(closestIndex + text.length),
        };
    }

    private findRangeByTextOccurrence(
        editor: EnhancedEditor,
        text: string,
        occurrence: number,
    ): { from: { line: number; ch: number }; to: { line: number; ch: number } } | null {
        if (!text.length || occurrence < 0 || !editor.offsetToPos) {
            return null;
        }

        const content = editor.getValue();
        let fromIndex = -1;
        let searchStart = 0;
        let current = 0;
        while (current <= occurrence) {
            fromIndex = content.indexOf(text, searchStart);
            if (fromIndex === -1) {
                return null;
            }
            searchStart = fromIndex + 1;
            current += 1;
        }

        return {
            from: editor.offsetToPos(fromIndex),
            to: editor.offsetToPos(fromIndex + text.length),
        };
    }

    private getMarkAttributeValue(attributes: string, name: string): string {
        const match = attributes.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
        if (!match) {
            return "";
        }
        return match[1]
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&");
    }

    private normalizeMarkText(value: string): string {
        return value
            .replace(/`<\s*([^`<>\s\/]+)\s*>`/g, " $1 ")
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&")
            .replace(/<\s*([^<>\s\/]+)\s*>/g, " $1 ")
            .replace(/`/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    private findMarkRangeFromPreviewElement(
        editor: EnhancedEditor,
        markEl: HTMLElement,
        preferredOffset?: number,
    ): { from: { line: number; ch: number }; to: { line: number; ch: number } } | null {
        if (!editor.offsetToPos) {
            return null;
        }

        const content = editor.getValue();
        const targetText = this.normalizeMarkText(markEl.innerHTML);
        const targetNote = markEl.getAttribute("data-note") ?? "";
        const targetTags = markEl.getAttribute("data-tags") ?? "";
        const matchRegex = /<mark\b([^>]*)>([\s\S]*?)<\/mark>/gi;
        const candidates: Array<{ start: number; end: number; score: number }> = [];

        let match: RegExpExecArray | null;
        while ((match = matchRegex.exec(content)) !== null) {
            const attributes = match[1] ?? "";
            const inner = match[2] ?? "";
            const text = this.normalizeMarkText(inner);
            if (text !== targetText) {
                continue;
            }

            let score = 10;
            const note = this.getMarkAttributeValue(attributes, "data-note");
            const tags = this.getMarkAttributeValue(attributes, "data-tags");
            if (note === targetNote) {
                score += 3;
            }
            if (tags === targetTags) {
                score += 3;
            }
            candidates.push({ start: match.index, end: match.index + match[0].length, score });
        }

        if (candidates.length === 0) {
            return null;
        }

        const target = preferredOffset ?? 0;
        candidates.sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            return Math.abs(a.start - target) - Math.abs(b.start - target);
        });

        const selected = candidates[0];
        return {
            from: editor.offsetToPos(selected.start),
            to: editor.offsetToPos(selected.end),
        };
    }

    private withPreservedEditorScroll(applyUpdate: () => void): void {
        const scroller = this.getActiveEditorScroller();
        const previousTop = scroller?.scrollTop ?? null;
        applyUpdate();
        if (scroller && previousTop !== null) {
            scroller.scrollTop = previousTop;
        }
    }

    private async setMarkdownViewMode(view: MarkdownView, mode: "source" | "preview"): Promise<void> {
        const leaf = view.leaf;
        const viewState = leaf.getViewState();
        await leaf.setViewState({
            ...viewState,
            state: {
                ...(viewState.state ?? {}),
                mode,
            },
        });
    }

    private restorePreviewWhenAnnotationModalCloses(view: MarkdownView): void {
        const activeDoc = this.getActiveDocument();
        const restoreIfReady = () => {
            const hasOpenAnnotationModal = !!activeDoc.querySelector('.highlightr-annotation-modal');
            if (hasOpenAnnotationModal) {
                window.setTimeout(restoreIfReady, 100);
                return;
            }
            void this.setMarkdownViewMode(view, "preview");
        };
        window.setTimeout(restoreIfReady, 0);
    }

    private async showReadingModeContextMenu(event: MouseEvent): Promise<void> {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.editor) {
            return;
        }

        const target = event.target as HTMLElement | null;
        if (!target) {
            return;
        }

        const previewRoot = target.closest('.markdown-preview-view');
        if (!previewRoot) {
            return;
        }

        const markEl = target.closest('mark') as HTMLElement | null;
        const noteIconEl = target.closest('.note-icon') as HTMLElement | null;
        const noteIconMark = noteIconEl?.previousElementSibling?.tagName.toLowerCase() === 'mark'
            ? noteIconEl.previousElementSibling as HTMLElement
            : null;
        const activeMarkEl = markEl ?? noteIconMark;

        const editor = view.editor as EnhancedEditor;
        const activeDoc = this.getActiveDocument();
        const selection = activeDoc.defaultView?.getSelection();
        const selectedText = selection?.toString() ?? "";

        if (!activeMarkEl && !selectedText.trim().length) {
            return;
        }

        const shouldRestorePreview = view.getMode() === "preview";
        if (shouldRestorePreview) {
            await this.setMarkdownViewMode(view, "source");
        }

        const clickOffset = editor.posToOffset?.(editor.getCursor("from"));
        const restorePreview = async () => {
            if (shouldRestorePreview) {
                await this.setMarkdownViewMode(view, "preview");
            }
        };

        const menu = new Menu();
        const menuWithNativeToggle = menu as Menu & {
            setUseNativeMenu?: (useNativeMenu: boolean) => Menu;
        };
        menuWithNativeToggle.setUseNativeMenu?.(false);

        if (activeMarkEl) {
            const resolvedRange = this.findMarkRangeFromPreviewElement(editor, activeMarkEl, clickOffset);
            if (!resolvedRange) {
                await restorePreview();
                return;
            }
            editor.setSelection(resolvedRange.from, resolvedRange.to);
        } else if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const startNode = range.startContainer;
            const endNode = range.endContainer;
            const markdownSourceRoot = previewRoot.querySelector('.markdown-preview-sizer') ?? previewRoot;
            if (!markdownSourceRoot.contains(startNode) || !markdownSourceRoot.contains(endNode)) {
                await restorePreview();
                return;
            }

            const nearestRange = this.findNearestRangeByText(editor, selectedText, clickOffset);
            if (!nearestRange) {
                await restorePreview();
                return;
            }

            editor.setSelection(nearestRange.from, nearestRange.to);
        }

        if (shouldRestorePreview) {
            menu.onHide(() => {
                this.restorePreviewWhenAnnotationModalCloses(view);
            });
        }

        contextMenu(this.app, menu, editor, this, this.settings);
        menu.showAtPosition({ x: event.clientX, y: event.clientY });
        event.preventDefault();
    }

    onload(): void {
        const init = async () => {
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

            this.editorMenuEventRef = (this.app.workspace as unknown as {
                on: (name: string, callback: (menu: Menu, editor: Editor) => void) => EventRef;
            }).on("editor-menu", (menu: Menu, editor: Editor) => {
                this.handleHighlighterInContextMenu(menu, editor as EnhancedEditor);
            });
            this.register(() => {
                if (this.editorMenuEventRef) {
                    this.app.workspace.offref(this.editorMenuEventRef);
                    this.editorMenuEventRef = null;
                }
            });

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
                    const runPostOpenPass = () => {
                        this.processMarkTags();
                        this.attachEventListeners();
                    };
                    this.removeExistingBubbles();
                    runPostOpenPass();
                    window.setTimeout(runPostOpenPass, 80);
                    window.setTimeout(runPostOpenPass, 240);
                    void this.refreshPreviewAfterFileOpen();
                    if (this.fileHasHighlights()) {
                        void this.openNotesTab();
                    }
                    this.triggerNotesTabUpdate();
                })
            );

            this.addSettingTab(new HighlightrSettingTab(this.app, this));

            this.addCommand({
                id: "highlighter-plugin-menu",
                name: "Open Highlightr",
                icon: "highlightr-pen",
                editorCallback: (editor: Editor) => {
                    showHighlightrMenuFromCommand(this, editor as EnhancedEditor);
                },
            });

            addEventListener("Highlightr-NewCommand", () => {
                this.reloadStyles(this.settings);
                this.generateCommands(this.editor);
                createHighlighterIcons(this.settings, this);
            });

            this.generateCommands(this.editor);
            this.refresh();
        };

        void init();
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

    private getActiveHighlighters(): string[] {
        const ordered = this.settings.highlighterOrder.length > 0
            ? this.settings.highlighterOrder
            : Object.keys(this.settings.highlighters);
        return ordered.filter((highlighter) => this.settings.highlighterActivity?.[highlighter] !== false);
    }

    generateCommands(editor: Editor) {
        this.getActiveHighlighters().forEach((highlighterKey: string) => {
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
                const prefixLast = prefix.replace(/^\s+/, "").slice(-1);

                if (suf === suffix.replace(/\s+$/, "")) {
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
        // Apply style classes to both the active document body and the workspace container
        const applyClass = (el: Element | null, cls: string, cond: boolean) => {
            if (!el) return;
            el.classList.toggle(cls, cond);
        };

        const condLow = this.settings.highlighterStyle === "lowlight";
        const condFloat = this.settings.highlighterStyle === "floating";
        const condRound = this.settings.highlighterStyle === "rounded";
        const condReal = this.settings.highlighterStyle === "realistic";

        applyClass(activeDoc?.body ?? null, "highlightr-lowlight", condLow);
        applyClass(activeDoc?.body ?? null, "highlightr-floating", condFloat);
        applyClass(activeDoc?.body ?? null, "highlightr-rounded", condRound);
        applyClass(activeDoc?.body ?? null, "highlightr-realistic", condReal);

        const workspaceEl = this.app?.workspace?.containerEl ?? null;
        applyClass(workspaceEl, "highlightr-lowlight", condLow);
        applyClass(workspaceEl, "highlightr-floating", condFloat);
        applyClass(workspaceEl, "highlightr-rounded", condRound);
        applyClass(workspaceEl, "highlightr-realistic", condReal);
    };

    onunload() {
        console.log("Highlightr unloaded");
        // Clean up click listener
        if (this.clickHandlerBound) {
            this.app.workspace.containerEl.removeEventListener('click', this.clickHandlerBound);
        }
        if (this.readingContextMenuHandlerBound) {
            this.app.workspace.containerEl.removeEventListener('contextmenu', this.readingContextMenuHandlerBound, true);
        }
    }

    handleHighlighterInContextMenu = (
        menu: Menu,
        editor: EnhancedEditor
    ): void => {
        contextMenu(this.app, menu, editor, this, this.settings);
    };

    async loadSettings() {
        const savedSettings = await this.loadData() as Partial<HighlightrSettings>;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, savedSettings);
        this.settings.highlighterClasses = this.settings.highlighterClasses || {};
        this.settings.highlighterActivity = this.settings.highlighterActivity || {};
        this.settings.highlighterOrder = this.settings.highlighterOrder || [];
        this.settings.conflictScanScope = this.settings.conflictScanScope || "active-file";
        this.settings.conflictScanFolder = this.settings.conflictScanFolder || "";

        const knownHighlighters = Array.from(new Set([
            ...Object.keys(this.settings.highlighters),
            ...this.settings.highlighterOrder,
        ]));

        const legacyStatuses = (this.settings as unknown as { highlighterStatuses?: Record<string, string> }).highlighterStatuses;

        knownHighlighters.forEach((highlighter) => {
            if (!this.settings.highlighters[highlighter]) {
                return;
            }
            const existingClass = this.settings.highlighterClasses[highlighter];
            if (!existingClass || !existingClass.trim()) {
                this.settings.highlighterClasses[highlighter] = createDefaultHighlighterClass(highlighter);
            }
            const activity = this.settings.highlighterActivity[highlighter];
            if (typeof activity !== "boolean") {
                const legacyStatus = legacyStatuses?.[highlighter];
                this.settings.highlighterActivity[highlighter] = legacyStatus === "inactive" ? false : true;
            }
            if (this.settings.highlighterOrder.indexOf(highlighter) === -1) {
                this.settings.highlighterOrder.push(highlighter);
            }
        });

        delete (this.settings as unknown as { highlighterStatuses?: unknown }).highlighterStatuses;
    }

    async saveSettings() {
        const settingsToSave = { ...this.settings } as unknown as { highlighterStatuses?: unknown };
        delete settingsToSave.highlighterStatuses;
        await this.saveData(settingsToSave);
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
        if (this.readingContextMenuHandlerBound) {
            workspaceEl.removeEventListener('contextmenu', this.readingContextMenuHandlerBound, true);
        }

        // Create new bound handler
        this.clickHandlerBound = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('.highlight-tag, .hltr-inline-label')) {
                e.stopPropagation();
                e.preventDefault();
                // Handle tag click logic here
            }
        };

        this.readingContextMenuHandlerBound = (e: MouseEvent) => {
            this.showReadingModeContextMenu(e);
        };

        workspaceEl.addEventListener('click', this.clickHandlerBound);
        workspaceEl.addEventListener('contextmenu', this.readingContextMenuHandlerBound, true);

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
                .replace(/<span\b[^>]*\bclass="[^"]*\b(?:note-icon|highlight-tag|highlight-tags|hltr-inline-label|hltr-highlight-tags)\b[^"]*"[^>]*>[\s\S]*?<\/span>/g, "");
        }

        return cleaned
            .replace(/<span\b[^>]*\bclass="[^"]*\b(?:note-icon|highlight-tag|highlight-tags|hltr-inline-label|hltr-highlight-tags)\b[^"]*"[^>]*>/g, "")
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
                (match: string, attrs: string, inner: string) => {
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
            .replace(/<span\b[^>]*\bclass="[^"]*\bnote-icon\b[^"]*"[^>]*>[\s\S]*?<\/span>/g, '')
            .replace(/<span\b[^>]*\bclass="[^"]*\bhighlight-tag\b[^"]*"[^>]*>[\s\S]*?<\/span>/g, '')
            .replace(/<span\b[^>]*\bclass="[^"]*\bhighlight-tags\b[^"]*"[^>]*>[\s\S]*?<\/span>/g, '')
            .replace(/<span\b[^>]*\bclass="[^"]*\bhltr-inline-label\b[^"]*"[^>]*>[\s\S]*?<\/span>/g, '')
            .replace(/<span\b[^>]*\bclass="[^"]*\bhltr-highlight-tags\b[^"]*"[^>]*>\s*<\/span>/g, '')
            .replace(/<span\b[^>]*\bclass="[^"]*\bhltr-highlight-tags\b[^"]*"[^>]*>(?:\s*<span class="hltr-inline-label">[\s\S]*?<\/span>\s*)*<\/span>/g, '');

        const rebuilt = cleaned.replace(
            /<mark\b([^>]*)>([\s\S]*?)<\/mark>/g,
            (match: string, attributes: string, innerContent: string) => {
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
                        .map((tag: string) => tag.replace(/\s+/g, '-'));
                    if (tagArray.length > 0) {
                        let tagsMarkup = '<span class="hltr-highlight-tags">';
                        tagArray.forEach((tag: string) => {
                            tagsMarkup += `<span class="hltr-inline-label">${tag}</span>`;
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

    private async refreshPreviewAfterFileOpen(): Promise<void> {
        if (this.isRefreshingPreviewAfterOpen) {
            return;
        }
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.getMode() !== "preview") {
            return;
        }

        this.isRefreshingPreviewAfterOpen = true;
        try {
            await this.setMarkdownViewMode(view, "source");
            this.processMarkTags();
            await this.setMarkdownViewMode(view, "preview");
            this.attachEventListeners();
        } finally {
            this.isRefreshingPreviewAfterOpen = false;
        }
    }

    private processMarkTags(): void {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.editor) return;

        const content = view.editor.getValue();
        if (!content) return;

        const cursorPos = view.editor.getCursor();

        const cleanContent = this.stripInjectedDecorationSpans(content)
            .replace(/<span\b[^>]*\bclass="[^"]*\bnote-icon\b[^"]*"[^>]*>[\s\S]*?<\/span>/g, '')
            .replace(/<span\b[^>]*\bclass="[^"]*\bhighlight-tag\b[^"]*"[^>]*>[\s\S]*?<\/span>/g, '')
            .replace(/<span\b[^>]*\bclass="[^"]*\bhighlight-tags\b[^"]*"[^>]*>[\s\S]*?<\/span>/g, '')
            .replace(/<span\b[^>]*\bclass="[^"]*\bhltr-inline-label\b[^"]*"[^>]*>[\s\S]*?<\/span>/g, '')
            .replace(/<span\b[^>]*\bclass="[^"]*\bhltr-highlight-tags\b[^"]*"[^>]*>\s*<\/span>/g, '')
            .replace(/<span\b[^>]*\bclass="[^"]*\bhltr-highlight-tags\b[^"]*"[^>]*>(?:\s*<span class="hltr-inline-label">[\s\S]*?<\/span>\s*)*<\/span>/g, '');

        const updatedContent = cleanContent.replace(
            /<mark\b([^>]*)>([\s\S]*?)<\/mark>/g,
            (match: string, attributes: string, innerContent: string) => {
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
                        .map((tag: string) => tag.replace(/\s+/g, '-'));
                    if (tagArray.length > 0) {
                        let tagsMarkup = '<span class="hltr-highlight-tags">';
                        tagArray.forEach((tag: string) => {
                            tagsMarkup += `<span class="hltr-inline-label">${tag}</span>`;
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
