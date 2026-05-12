export const HIGHLIGHTER_STYLES = [
  "none",
  "lowlight",
  "floating",
  "rounded",
  "realistic",
];

export const HIGHLIGHTER_METHODS = ["css-classes", "inline-styles"];

export interface Highlighters {
  [color: string]: string;
}

export interface HighlighterClasses {
  [color: string]: string;
}

export function createDefaultHighlighterClass(colorName: string): string {
  return colorName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "");
}

export interface HighlightrSettings {
  highlighterStyle: string;
  highlighterMethods: string;
  highlighters: Highlighters;
  highlighterClasses: HighlighterClasses;
  highlighterOrder: string[];
}

const DEFAULT_SETTINGS: HighlightrSettings = {
  highlighterStyle: "none",
  highlighterMethods: "inline-styles",
  highlighters: {
    Pink: "#FFB8EBA6",
    Red: "#FF5582A6",
    Orange: "#FFB86CA6",
    Yellow: "#FFF3A3A6",
    Green: "#BBFABBA6",
    Cyan: "#ABF7F7A6",
    Blue: "#ADCCFFA6",
    Purple: "#D2B3FFA6",
    Grey: "#CACFD9A6",
  },
  highlighterClasses: {},
  highlighterOrder: [],
};

DEFAULT_SETTINGS.highlighterOrder = Object.keys(DEFAULT_SETTINGS.highlighters);
DEFAULT_SETTINGS.highlighterOrder.forEach((highlighter) => {
  DEFAULT_SETTINGS.highlighterClasses[highlighter] = createDefaultHighlighterClass(highlighter);
});

export default DEFAULT_SETTINGS;
