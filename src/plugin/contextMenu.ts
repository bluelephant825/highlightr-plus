import type HighlightrPlugin from "./main";
import { Menu, Modal, Setting } from "obsidian";
import { HighlightrSettings, createDefaultHighlighterClass } from "../settings/settingsData";
import { EnhancedApp, EnhancedEditor } from "../settings/types";

const MARK_REGEX = /<mark\b[^>]*>[\s\S]*?<\/mark>/g;

interface LastContextClick {
  target: EventTarget | null;
  x: number;
  y: number;
  time: number;
}

interface EditorRange {
  from: { line: number; ch: number };
  to: { line: number; ch: number };
}

interface ParsedMark {
  attributes: string;
  innerContent: string;
  hasStyle: boolean;
  hasHighlightClass: boolean;
  hasHighlight: boolean;
  hasDataNote: boolean;
  hasDataTags: boolean;
  hasAnnotation: boolean;
  note: string;
  tags: string;
}

type ContextMenuItem = {
  dom?: HTMLElement;
  setSubmenu?: () => Menu & { setUseNativeMenu?: (useNativeMenu: boolean) => Menu };
  setTitle?: (title: string) => unknown;
  setIcon?: (icon: string) => unknown;
  onClick?: (handler: () => void) => unknown;
};

interface AnnotationResult {
  note: string;
  tags: string;
}

const lastContextClick: LastContextClick = {
  target: null,
  x: 0,
  y: 0,
  time: 0,
};

let listenerInstalled = false;

class AnnotationModal extends Modal {
  private readonly initialNote: string;
  private readonly initialTags: string;
  private readonly onSubmit: (result: AnnotationResult | null) => void;
  private resolved = false;

  constructor(
    app: EnhancedApp,
    initialNote: string,
    initialTags: string,
    onSubmit: (result: AnnotationResult | null) => void,
  ) {
    super(app);
    this.initialNote = initialNote;
    this.initialTags = initialTags;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    this.modalEl.classList.add("highlightr-annotation-modal");

    const { contentEl } = this;
    contentEl.empty();
    contentEl.classList.add("highlightr-annotation-content");

    const noteLabel = contentEl.createEl("label", { text: "Annotation:" });
    noteLabel.classList.add("highlightr-annotation-label");

    const noteArea = contentEl.createEl("textarea");
    noteArea.value = this.initialNote;
    noteArea.classList.add("highlightr-annotation-textarea");

    const tagsLabel = contentEl.createEl("label", { text: "Tags:" });
    tagsLabel.classList.add("highlightr-annotation-label");

    const tagsInput = contentEl.createEl("input", { type: "text" });
    tagsInput.value = this.initialTags;
    tagsInput.classList.add("highlightr-annotation-input");

    const controls = contentEl.createDiv();
    controls.classList.add("highlightr-annotation-controls");

    new Setting(controls)
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => {
          this.resolved = true;
          this.onSubmit(null);
          this.close();
        });
      })
      .addButton((button) => {
        button.setButtonText("OK").setCta().onClick(() => {
          this.resolved = true;
          this.onSubmit({
            note: noteArea.value,
            tags: tagsInput.value,
          });
          this.close();
        });
      });
  }

  onClose() {
    this.contentEl.empty();
    if (!this.resolved) {
      this.onSubmit(null);
    }
  }
}

function ensureContextMenuListener() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  window.addEventListener(
    "contextmenu",
    (evt: MouseEvent) => {
      lastContextClick.target = evt.target;
      lastContextClick.x = evt.clientX;
      lastContextClick.y = evt.clientY;
      lastContextClick.time = Date.now();
    },
    true,
  );
}

function findAncestor(el: Element | null, className: string, doc?: Document): Element | null {
  let node = el;
  const body = doc?.body ?? activeDocument.body;
  while (node && node !== body) {
    if (node.classList.contains(className)) return node;
    node = node.parentElement;
  }
  return null;
}

function isHighlightedElement(el: Element | null, doc?: Document): boolean {
  let node: Element | null = el;
  const body = doc?.body ?? activeDocument.body;
  while (node && node !== body) {
    if (node.tagName === "MARK") return true;
    const cls = node.classList;
    if (cls && (cls.contains("cm-highlight") || cls.contains("cm-formatting-highlight"))) {
      return true;
    }
    if (cls) {
      for (let i = 0; i < cls.length; i++) {
        if (cls[i].startsWith("hltr-")) return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

function findMarkRangeAt(
  editor: EnhancedEditor,
  pos: { line: number; ch: number },
): EditorRange | null {
  const line = editor.getLine(pos.line);
  MARK_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARK_REGEX.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (pos.ch >= start && pos.ch <= end) {
      return {
        from: { line: pos.line, ch: start },
        to: { line: pos.line, ch: end },
      };
    }
  }
  return null;
}

function findLastMarkRangeBefore(
  editor: EnhancedEditor,
  pos: { line: number; ch: number },
): EditorRange | null {
  const line = editor.getLine(pos.line);
  MARK_REGEX.lastIndex = 0;
  let result: EditorRange | null = null;
  let match: RegExpExecArray | null;
  while ((match = MARK_REGEX.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (end <= pos.ch + 1) {
      result = {
        from: { line: pos.line, ch: start },
        to: { line: pos.line, ch: end },
      };
      continue;
    }
    break;
  }
  return result;
}

function findMarkRangeAtCoords(
  editor: EnhancedEditor,
  x: number,
  y: number,
): EditorRange | null {
  const cm = editor.cm;
  if (!cm) return null;
  let offset: number | null = null;
  try {
    if (typeof cm.posAtCoords === "function") {
      const result = cm.posAtCoords({ x, y });
      if (typeof result === "number") offset = result;
      else if (result && typeof result.pos === "number") offset = result.pos;
    }
  } catch {
    offset = null;
  }
  if (offset == null) return null;
  try {
    const pos = editor.offsetToPos(offset);
    return findMarkRangeAt(editor, pos);
  } catch {
    return null;
  }
}

function findMarkRangeBeforeCoords(
  editor: EnhancedEditor,
  x: number,
  y: number,
): EditorRange | null {
  const cm = editor.cm;
  if (!cm) return null;
  let offset: number | null = null;
  try {
    if (typeof cm.posAtCoords === "function") {
      const result = cm.posAtCoords({ x, y });
      if (typeof result === "number") offset = result;
      else if (result && typeof result.pos === "number") offset = result.pos;
    }
  } catch {
    offset = null;
  }
  if (offset == null) return null;
  try {
    const pos = editor.offsetToPos(offset);
    return findLastMarkRangeBefore(editor, pos);
  } catch {
    return null;
  }
}

function findMarkRangeAtCursor(editor: EnhancedEditor): EditorRange | null {
  return findMarkRangeAt(editor, editor.getCursor("from"));
}

function escapeAttributeValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unescapeAttributeValue(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function getAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
  return match ? unescapeAttributeValue(match[1]) : null;
}

function hasHighlightClass(attributes: string): boolean {
  const classValue = getAttribute(attributes, "class");
  if (!classValue) return false;
  return classValue.split(/\s+/).some((token) => token.startsWith("hltr-"));
}

function parseMark(markText: string): ParsedMark | null {
  const match = markText.match(/^<mark\b([^>]*)>([\s\S]*?)<\/mark>$/i);
  if (!match) return null;
  const attributes = (match[1] || "").trim();
  const note = getAttribute(attributes, "data-note") ?? "";
  const tags = getAttribute(attributes, "data-tags") ?? "";
  const hasDataNote = /\bdata-note\s*=/.test(attributes);
  const hasDataTags = /\bdata-tags\s*=/.test(attributes);
  const hasStyle = /\bstyle\s*=/.test(attributes);
  const highlightClass = hasHighlightClass(attributes);
  return {
    attributes,
    innerContent: match[2],
    hasStyle,
    hasHighlightClass: highlightClass,
    hasHighlight: hasStyle || highlightClass,
    hasDataNote,
    hasDataTags,
    hasAnnotation: hasDataNote || hasDataTags,
    note,
    tags,
  };
}

function setAttribute(attributes: string, name: string, value: string): string {
  const escaped = escapeAttributeValue(value);
  const regex = new RegExp(`\\b${name}="[^"]*"`, "i");
  if (regex.test(attributes)) {
    return attributes.replace(regex, `${name}="${escaped}"`).trim();
  }
  return `${attributes} ${name}="${escaped}"`.trim();
}

function removeAttribute(attributes: string, name: string): string {
  return attributes
    .replace(new RegExp(`\\s*\\b${name}="[^"]*"`, "ig"), "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function removeHighlightStyling(attributes: string): string {
  let next = removeAttribute(attributes, "style");
  const classValue = getAttribute(next, "class");
  if (!classValue) return next;
  const remainingClasses = classValue
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !token.startsWith("hltr-"));
  if (remainingClasses.length === 0) {
    next = removeAttribute(next, "class");
    return next;
  }
  return setAttribute(next, "class", remainingClasses.join(" "));
}

function createMark(innerContent: string, attributes: string): string {
  const attr = attributes.trim();
  if (!attr) return `<mark>${innerContent}</mark>`;
  return `<mark ${attr}>${innerContent}</mark>`;
}

function replaceRange(editor: EnhancedEditor, range: EditorRange, nextText: string): void {
  editor.setSelection(range.from, range.to);
  editor.replaceSelection(nextText);
  editor.focus();
}

function annotateWithModal(
  app: EnhancedApp,
  note: string,
  tags: string,
): Promise<AnnotationResult | null> {
  return new Promise((resolve) => {
    const modal = new AnnotationModal(app, note, tags, (result) => resolve(result));
    modal.open();
  });
}

function getActiveHighlighters(settings: HighlightrSettings): string[] {
  const ordered = settings.highlighterOrder.length > 0
    ? settings.highlighterOrder
    : Object.keys(settings.highlighters);
  return ordered.filter((highlighter) => settings.highlighterActivity?.[highlighter] !== false);
}

function addColorSubmenu(
  menu: Menu,
  title: string,
  settings: HighlightrSettings,
  onColor: (highlighter: string, color: string) => void,
): void {
  const orderedHighlighters = getActiveHighlighters(settings);
  if (orderedHighlighters.length === 0) {
    return;
  }

  menu.addItem((item) => {
    item.setTitle(title).setIcon("highlightr-pen");
    const contextItem = item as unknown as ContextMenuItem;
    if (typeof contextItem.setSubmenu !== "function") {
      item.onClick(() => {
        const first = getActiveHighlighters(settings)[0];
        if (!first) return;
        onColor(first, settings.highlighters[first]);
      });
      return;
    }
    const submenu = contextItem.setSubmenu();
    submenu?.setUseNativeMenu?.(false);
    const orderedHighlighters = getActiveHighlighters(settings);
    orderedHighlighters.forEach((highlighter) => {
      submenu?.addItem((highlighterItem) => {
        const menuItem = highlighterItem as unknown as ContextMenuItem;
        const color = settings.highlighters[highlighter];
        menuItem.setTitle?.(highlighter);
        menuItem.setIcon?.("highlighter");
        menuItem.onClick?.(() => onColor(highlighter, color));
        const itemDom = menuItem.dom;
        if (itemDom) {
          itemDom.addClass("highlightr-color-menu-item");
          itemDom.style.setProperty("--highlightr-color", color && color.trim().length > 0 ? color : "transparent");
        }
      });
    });
  });
}

export default function contextMenu(
  app: EnhancedApp,
  menu: Menu,
  editor: EnhancedEditor,
  plugin: HighlightrPlugin,
  settings: HighlightrSettings,
): void {
  ensureContextMenuListener();

  const selection = editor.getSelection();
  const hasSelection = selection.length > 0;

  const menuWithNativeToggle = menu as Menu & {
    setUseNativeMenu?: (useNativeMenu: boolean) => Menu;
  };
  menuWithNativeToggle.setUseNativeMenu?.(false);

  const selectedMark = hasSelection ? parseMark(selection) : null;
  const selectedMarkRange = selectedMark
    ? { from: editor.getCursor("from"), to: editor.getCursor("to") }
    : null;

  let clickedMarkRange: EditorRange | null = null;
  let clickedNoteIcon = false;

  if (Date.now() - lastContextClick.time < 1500) {
    const target = lastContextClick.target as Element | null;
    const activeDoc = app.workspace.activeDocument ?? activeDocument;
    const noteIcon = target ? findAncestor(target, "note-icon", activeDoc) : null;
    clickedNoteIcon = !!noteIcon;
    if (clickedNoteIcon) {
      clickedMarkRange = findMarkRangeBeforeCoords(editor, lastContextClick.x, lastContextClick.y);
    } else if (target && isHighlightedElement(target, activeDoc)) {
      clickedMarkRange = findMarkRangeAtCoords(editor, lastContextClick.x, lastContextClick.y);
    }
  }

  const cursorMarkRange = !selectedMark ? findMarkRangeAtCursor(editor) : null;
  const activeRange = selectedMarkRange ?? clickedMarkRange ?? cursorMarkRange;

  const activeMarkText = activeRange ? editor.getRange(activeRange.from, activeRange.to) : null;
  const activeMark = activeMarkText ? parseMark(activeMarkText) : null;

  const hasActiveMark = !!activeRange && !!activeMark;
  const hasActiveAnnotation = hasActiveMark ? activeMark.hasAnnotation : false;
  const hasActiveHighlight = hasActiveMark ? activeMark.hasHighlight : false;

  const finalizeAfterEdit = () => {
    plugin.suppressFullPostProcessing(450);
    plugin.syncDecorationsNearSelection(editor);
  };

  const annotateSelection = async () => {
    if (!hasSelection) return;
    const result = await annotateWithModal(app, "", "");
    if (!result) return;
    if (!result.note.trim() && !result.tags.trim()) return;
    const wrapped = `<mark data-note="${escapeAttributeValue(result.note)}" data-tags="${escapeAttributeValue(result.tags)}">${selection}</mark>`;
    editor.replaceSelection(wrapped);
    editor.focus();
    finalizeAfterEdit();
  };

  const annotateMark = async (range: EditorRange, parsed: ParsedMark, isEdit: boolean) => {
    const startNote = isEdit ? parsed.note : "";
    const startTags = isEdit ? parsed.tags : "";
    const result = await annotateWithModal(app, startNote, startTags);
    if (!result) return;
    let attributes = parsed.attributes;
    attributes = setAttribute(attributes, "data-note", result.note);
    attributes = setAttribute(attributes, "data-tags", result.tags);
    replaceRange(editor, range, createMark(parsed.innerContent, attributes));
    finalizeAfterEdit();
  };

  const applyHighlightToSelection = (highlighter: string, color: string) => {
    if (!hasSelection) return;
    const isCssClassesMode = settings.highlighterMethods === "css-classes";
    const className = (settings.highlighterClasses?.[highlighter] ?? createDefaultHighlighterClass(highlighter)).toLowerCase();
    const wrapped = isCssClassesMode
      ? `<mark class="hltr-${className}" style="--hltr-color: ${color};">${selection}</mark>`
      : `<mark style="background-color: ${color};">${selection}</mark>`;
    editor.replaceSelection(wrapped);
    editor.focus();
    finalizeAfterEdit();
  };

  const applyHighlightToMark = (range: EditorRange, parsed: ParsedMark, highlighter: string, color: string) => {
    let attributes = parsed.attributes;
    attributes = removeHighlightStyling(attributes);
    if (settings.highlighterMethods === "css-classes") {
      const className = (settings.highlighterClasses?.[highlighter] ?? createDefaultHighlighterClass(highlighter)).toLowerCase();
      const classValue = getAttribute(attributes, "class");
      const remainingClasses = classValue
        ? classValue
            .split(/\s+/)
            .map((token) => token.trim())
            .filter((token) => token.length > 0 && !token.startsWith("hltr-"))
        : [];
      remainingClasses.push(`hltr-${className}`);
      attributes = setAttribute(attributes, "class", remainingClasses.join(" "));
      attributes = setAttribute(attributes, "style", `--hltr-color: ${color};`);
    } else {
      attributes = setAttribute(attributes, "style", `background-color: ${color};`);
    }
    replaceRange(editor, range, createMark(parsed.innerContent, attributes));
    finalizeAfterEdit();
  };

  const eraseHighlight = (range: EditorRange, parsed: ParsedMark) => {
    if (parsed.hasAnnotation) {
      const attributes = removeHighlightStyling(parsed.attributes);
      replaceRange(editor, range, createMark(parsed.innerContent, attributes));
      finalizeAfterEdit();
      return;
    }
    replaceRange(editor, range, parsed.innerContent);
    finalizeAfterEdit();
  };

  const eraseAnnotation = (range: EditorRange, parsed: ParsedMark) => {
    let attributes = parsed.attributes;
    attributes = removeAttribute(attributes, "data-note");
    attributes = removeAttribute(attributes, "data-tags");
    if (!attributes.trim()) {
      replaceRange(editor, range, parsed.innerContent);
      finalizeAfterEdit();
      return;
    }
    replaceRange(editor, range, createMark(parsed.innerContent, attributes));
    finalizeAfterEdit();
  };

  const eraseHighlightAndAnnotation = (range: EditorRange, parsed: ParsedMark) => {
    replaceRange(editor, range, parsed.innerContent);
    finalizeAfterEdit();
  };

  if (!hasActiveMark && hasSelection) {
    addColorSubmenu(menu, "Highlight", settings, (highlighter, color) => {
      applyHighlightToSelection(highlighter, color);
    });

    menu.addItem((item) => {
      item
        .setTitle("Annotate")
        .setIcon("sticky-note")
        .onClick(() => {
          void annotateSelection();
        });
    });
    return;
  }

  if (!hasActiveMark || !activeRange || !activeMark) {
    return;
  }

  if (hasActiveHighlight && !hasActiveAnnotation) {
    menu.addItem((item) => {
      item
        .setTitle("Unhighlight")
        .setIcon("highlightr-eraser")
        .onClick(() => eraseHighlight(activeRange, activeMark));
    });

    addColorSubmenu(menu, "Change highlight color", settings, (highlighter, color) => {
      applyHighlightToMark(activeRange, activeMark, highlighter, color);
    });

    menu.addItem((item) => {
      item
        .setTitle("Annotate")
        .setIcon("sticky-note")
        .onClick(() => {
          void annotateMark(activeRange, activeMark, false);
        });
    });
    return;
  }

  if (hasActiveHighlight && hasActiveAnnotation) {
    menu.addItem((item) => {
      item
        .setTitle("Unhighlight")
        .setIcon("highlightr-eraser")
        .onClick(() => eraseHighlight(activeRange, activeMark));
    });

    addColorSubmenu(menu, "Change highlight color", settings, (highlighter, color) => {
      applyHighlightToMark(activeRange, activeMark, highlighter, color);
    });

    menu.addItem((item) => {
      item
        .setTitle("Erase annotation")
        .setIcon("trash")
        .onClick(() => eraseAnnotation(activeRange, activeMark));
    });

    menu.addItem((item) => {
      item
        .setTitle("Erase highlight & annotation")
        .setIcon("trash")
        .onClick(() => eraseHighlightAndAnnotation(activeRange, activeMark));
    });

    menu.addItem((item) => {
      item
        .setTitle("Edit annotation")
        .setIcon("pencil")
        .onClick(() => {
          void annotateMark(activeRange, activeMark, true);
        });
    });
    return;
  }

  if (!hasActiveHighlight && hasActiveAnnotation) {
    addColorSubmenu(menu, "Highlight", settings, (highlighter, color) => {
      applyHighlightToMark(activeRange, activeMark, highlighter, color);
    });

    menu.addItem((item) => {
      item
        .setTitle("Erase annotation")
        .setIcon("trash")
        .onClick(() => eraseAnnotation(activeRange, activeMark));
    });

    menu.addItem((item) => {
      item
        .setTitle("Edit annotation")
        .setIcon("pencil")
        .onClick(() => {
          void annotateMark(activeRange, activeMark, true);
        });
    });
    return;
  }

  if (clickedNoteIcon) {
    addColorSubmenu(menu, "Highlight", settings, (highlighter, color) => {
      applyHighlightToMark(activeRange, activeMark, highlighter, color);
    });
  }
}
