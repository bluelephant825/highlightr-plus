import { App, Editor, Menu } from "obsidian";

export interface Coords {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export type EnhancedMenu = Menu & { dom: HTMLElement };

export type EnhancedApp = App & {
  commands: { executeCommandById: (commandId: string) => void };
  workspace: App["workspace"] & {
    activeDocument?: Document | null;
  };
};

export type EnhancedEditor = Editor & {
  cursorCoords?: (where?: boolean, mode?: "window" | "local") => Coords | null;
  coordsAtPos?: (offset: number) => Coords | null;
  posToOffset?: (pos: { line: number; ch: number }) => number;
  offsetToPos?: (offset: number) => { line: number; ch: number };
  cm: CodeMirror.Editor & {
    posAtCoords?: (coords: { x: number; y: number }) => number | { pos: number } | null;
    coordsAtPos?: (offset: number) => Coords | null;
  };
  hasFocus: () => boolean;
};
