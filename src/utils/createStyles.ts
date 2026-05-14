import { HighlightrSettings, createDefaultHighlighterClass } from "../settings/settingsData";

export function createStyles(settings: HighlightrSettings, activeDocument: Document | null) {
  const doc = activeDocument ?? document;
  const root = doc.documentElement;

  Object.keys(settings.highlighters).forEach((highlighter) => {
    const className = (settings.highlighterClasses?.[highlighter] ?? createDefaultHighlighterClass(highlighter)).toLowerCase();
    root.style.setProperty(`--hltr-${className}`, settings.highlighters[highlighter]);
  });
}
