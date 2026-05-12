import { HighlightrSettings, createDefaultHighlighterClass } from "../settings/settingsData";
import { setAttributes } from "./setAttributes";

function addNewStyle(selector: any, style: any, sheet: HTMLElement) {
  sheet.textContent += selector + `{\n ${style}\n}\n\n`;
}

export function createStyles(settings: HighlightrSettings) {
  let styleSheet = document.createElement("style");
  setAttributes(styleSheet, {
    type: "text/css",
    id: "highlightr-styles",
  });

  let header = document.getElementsByTagName("HEAD")[0];
  header.appendChild(styleSheet);

  Object.keys(settings.highlighters).forEach((highlighter) => {
    const className = (settings.highlighterClasses?.[highlighter] ?? createDefaultHighlighterClass(highlighter)).toLowerCase();
    addNewStyle(
      `.hltr-${className},\nmark.hltr-${className},\n.markdown-preview-view mark.hltr-${className}`,
      `background: ${settings.highlighters[highlighter]};`,
      styleSheet
    );
  });
}
