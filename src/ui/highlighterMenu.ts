import { Menu, Notice } from "obsidian";
import { HighlightrSettings } from "../settings/settingsData";
import {
  Coords,
  EnhancedApp,
  EnhancedEditor,
  EnhancedMenu,
} from "../settings/types";

const highlighterMenu = (
  app: EnhancedApp,
  settings: HighlightrSettings,
  editor: EnhancedEditor
): void => {
  if (editor && editor.hasFocus()) {
    const cursor = editor.getCursor("from");
    let coords: Coords;

    const menu = new Menu() as unknown as EnhancedMenu;

    menu.setUseNativeMenu(false);

    const menuDom = menu.dom;
    menuDom.addClass("highlighterContainer");

    settings.highlighterOrder.forEach((highlighter) => {
      menu.addItem((highlighterItem) => {
        const color = settings.highlighters[highlighter];
        highlighterItem.setTitle(highlighter).setIcon("highlighter");
        highlighterItem.onClick(() => {
          app.commands.executeCommandById(`highlightr-plugin:${highlighter}`);
        });
        const itemDom = (highlighterItem as any).dom as HTMLElement;
        itemDom.addClass("highlightr-color-menu-item");
        itemDom.style.setProperty("--highlightr-color", color && color.trim().length > 0 ? color : "transparent");
      });
    });

    if (editor.cursorCoords) {
      coords = editor.cursorCoords(true, "window");
    } else if (editor.coordsAtPos) {
      const offset = editor.posToOffset(cursor);
      coords = editor.cm.coordsAtPos?.(offset) ?? editor.coordsAtPos(offset);
    } else {
      return;
    }

    menu.showAtPosition({
      x: coords.right + 25,
      y: coords.top + 20,
    });
  } else {
    new Notice("Focus must be in editor");
  }
};

export default highlighterMenu;
