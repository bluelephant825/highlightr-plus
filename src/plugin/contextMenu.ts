import type HighlightrPlugin from "./main";
import { Menu } from "obsidian";
import { HighlightrSettings } from "../settings/settingsData";
import highlighterMenu from "../ui/highlighterMenu";
import { EnhancedApp, EnhancedEditor } from "../settings/types";

const MARK_REGEX = /<mark\b[^>]*>[\s\S]*?<\/mark>/g;

interface LastContextClick {
  target: EventTarget | null;
  x: number;
  y: number;
  time: number;
}

const lastContextClick: LastContextClick = {
  target: null,
  x: 0,
  y: 0,
  time: 0,
};

let listenerInstalled = false;

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

function isHighlightedElement(el: Element | null): boolean {
  let node: Element | null = el;
  while (node && node !== document.body) {
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
): { from: { line: number; ch: number }; to: { line: number; ch: number } } | null {
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

function findMarkRangeAtCursor(editor: EnhancedEditor) {
  return findMarkRangeAt(editor, editor.getCursor("from"));
}

function findMarkRangeAtCoords(
  editor: EnhancedEditor,
  x: number,
  y: number,
): { from: { line: number; ch: number }; to: { line: number; ch: number } } | null {
  const cm: any = editor.cm;
  if (!cm) return null;
  let offset: number | null = null;
  try {
    if (typeof cm.posAtCoords === "function") {
      const result = cm.posAtCoords({ x, y });
      if (typeof result === "number") offset = result;
      else if (result && typeof result.pos === "number") offset = result.pos;
    }
  } catch (_) {
    offset = null;
  }
  if (offset == null) return null;
  try {
    const pos = editor.offsetToPos(offset);
    return findMarkRangeAt(editor, pos);
  } catch (_) {
    return null;
  }
}

function selectionContainsHighlight(selection: string): boolean {
  return /<mark\b/i.test(selection);
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
  const menuWithNativeToggle = menu as Menu & {
    setUseNativeMenu?: (useNativeMenu: boolean) => Menu;
  };
  menuWithNativeToggle.setUseNativeMenu?.(false);

  menu.addItem((item) => {
    const itemDom = (item as any).dom as HTMLElement;
    itemDom.addClass("highlighter-button");
    item.setTitle("Highlight").setIcon("highlightr-pen");

    const highlightItem = item as any;
    if (typeof highlightItem.setSubmenu === "function") {
      const submenu = highlightItem.setSubmenu() as Menu & {
        setUseNativeMenu?: (useNativeMenu: boolean) => Menu;
      };
      submenu.setUseNativeMenu?.(false);
      const orderedHighlighters =
        settings.highlighterOrder.length > 0
          ? settings.highlighterOrder
          : Object.keys(settings.highlighters);

      orderedHighlighters.forEach((highlighter) => {
        submenu.addItem((highlighterItem: any) => {
          const color = settings.highlighters[highlighter];
          highlighterItem
            .setTitle(highlighter)
            .setIcon("highlighter")
            .onClick(() => {
              app.commands.executeCommandById(`highlightr-plugin:${highlighter}`);
            });
          const itemDom = highlighterItem.dom as HTMLElement;
          itemDom.addClass("highlightr-color-menu-item");
          itemDom.style.setProperty("--highlightr-color", color && color.trim().length > 0 ? color : "transparent");
        });
      });
      return;
    }

    item.onClick(() => {
      highlighterMenu(app, settings, editor);
    });
  });

  const selectionHasHighlight = selection.length > 0 && selectionContainsHighlight(selection);

  let clickedHighlightEl: Element | null = null;
  let clickRange: { from: { line: number; ch: number }; to: { line: number; ch: number } } | null = null;
  if (Date.now() - lastContextClick.time < 1500) {
    const target = lastContextClick.target as Element | null;
    if (target && isHighlightedElement(target)) {
      clickedHighlightEl = target;
      clickRange = findMarkRangeAtCoords(editor, lastContextClick.x, lastContextClick.y);
    }
  }

  const markRangeAtCursor = !selectionHasHighlight ? findMarkRangeAtCursor(editor) : null;
  const eraseRange = clickRange ?? markRangeAtCursor;

  if (selectionHasHighlight || clickedHighlightEl || eraseRange) {
    menu.addItem((item) => {
      item
        .setTitle("Erase highlight")
        .setIcon("highlightr-eraser")
        .onClick(() => {
          if (!editor.getSelection() && eraseRange) {
            editor.setSelection(eraseRange.from, eraseRange.to);
          }
          if (editor.getSelection()) {
            plugin.eraseHighlight(editor);
          }
        });
    });
  }
}
