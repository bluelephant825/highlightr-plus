import { HighlightrSettings, createDefaultHighlighterClass } from "../settings/settingsData";

export function createStyles(settings: HighlightrSettings, activeDocument: Document | null) {
  if (!activeDocument) {
    return;
  }

  const root = activeDocument.documentElement;

  Object.keys(settings.highlighters).forEach((highlighter) => {
    const className = (settings.highlighterClasses?.[highlighter] ?? createDefaultHighlighterClass(highlighter)).toLowerCase();
    root.style.setProperty(`--hltr-${className}`, settings.highlighters[highlighter]);
  });
}
