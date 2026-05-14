import type HighlightrPlugin from "../plugin/main";
import {
  App,
  Setting,
  PluginSettingTab,
  Notice,
  TextComponent,
  Modal,
  TFile,
} from "obsidian";
import Pickr from "@simonwep/pickr";
import Sortable from "sortablejs";
import { HIGHLIGHTER_METHODS, HIGHLIGHTER_STYLES, createDefaultHighlighterClass } from "./settingsData";
import { setAttributes } from "../utils/setAttributes";

class DeleteHighlighterModal extends Modal {
  private readonly onSubmit: (confirmed: boolean) => void;
  private resolved = false;

  constructor(app: App, onSubmit: (confirmed: boolean) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", {
      text: "This action will permanently remove the highlight color. In the future, using the same color name for a new highlight color may create a conflict.",
    });
    const controls = contentEl.createDiv();
    new Setting(controls)
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => {
          this.resolved = true;
          this.onSubmit(false);
          this.close();
        });
      })
      .addButton((button) => {
        button.setButtonText("OK").setCta().onClick(() => {
          this.resolved = true;
          this.onSubmit(true);
          this.close();
        });
      });
  }

  onClose() {
    this.contentEl.empty();
    if (!this.resolved) {
      this.onSubmit(false);
    }
  }
}

type ConflictAction = "rename" | "reuse-without-migration" | "reuse-with-migration";

type ClassConflictSummary = {
  classToken: string;
  totalMarks: number;
  fileCount: number;
  inlineColorCounts: Record<string, number>;
  topFiles: Array<{ path: string; marks: number }>;
};

class HighlighterClassConflictModal extends Modal {
  private readonly summary: ClassConflictSummary;
  private readonly colorName: string;
  private readonly targetColorHex: string;
  private readonly onSubmit: (action: ConflictAction) => void;
  private resolved = false;

  constructor(
    app: App,
    summary: ClassConflictSummary,
    colorName: string,
    targetColorHex: string,
    onSubmit: (action: ConflictAction) => void,
  ) {
    super(app);
    this.summary = summary;
    this.colorName = colorName;
    this.targetColorHex = targetColorHex;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Potential highlight class conflict" });
    contentEl.createEl("p", {
      text: `A highlight class conflict was found for ${this.colorName}: ${this.summary.classToken}.`,
    });
    contentEl.createEl("p", {
      text: `Found ${this.summary.totalMarks} matching mark(s) in ${this.summary.fileCount} file(s). New color value: ${this.targetColorHex}.`,
    });

    const colorsFound = Object.keys(this.summary.inlineColorCounts).map((color) => ({
      color,
      count: this.summary.inlineColorCounts[color],
    }));
    if (colorsFound.length > 0) {
      const details = contentEl.createEl("ul");
      colorsFound.forEach((entry) => {
        details.createEl("li", { text: `${entry.color}: ${entry.count}` });
      });
    }

    if (this.summary.topFiles.length > 0) {
      contentEl.createEl("p", { text: "Top impacted files:" });
      const fileDetails = contentEl.createEl("ul");
      this.summary.topFiles.forEach((entry) => {
        fileDetails.createEl("li", { text: `${entry.path} (${entry.marks})` });
      });
    }

    contentEl.createEl("p", {
      text: "Do you wish to overwrite highlight colors using the same name or choose a different highlight color name to keep both colors?",
    });

    const controls = contentEl.createDiv();
    new Setting(controls)
      .addButton((button) => {
        button.setButtonText("Choose different name").onClick(() => {
          this.resolved = true;
          this.onSubmit("rename");
          this.close();
        });
      })
      .addButton((button) => {
        button.setButtonText("Reuse without migration").onClick(() => {
          this.resolved = true;
          this.onSubmit("reuse-without-migration");
          this.close();
        });
      })
      .addButton((button) => {
        button.setButtonText("Reuse and migrate").setCta().onClick(() => {
          this.resolved = true;
          this.onSubmit("reuse-with-migration");
          this.close();
        });
      });
  }

  onClose() {
    this.contentEl.empty();
    if (!this.resolved) {
      this.onSubmit("rename");
    }
  }
}

export class HighlightrSettingTab extends PluginSettingTab {
  plugin: HighlightrPlugin;

  constructor(app: App, plugin: HighlightrPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private getActiveHighlighters(): string[] {
    const ordered = this.plugin.settings.highlighterOrder.length > 0
      ? this.plugin.settings.highlighterOrder
      : Object.keys(this.plugin.settings.highlighters);
    return ordered.filter((highlighter) => this.plugin.settings.highlighterActivity?.[highlighter] !== false);
  }

  private getInactiveHighlighters(): string[] {
    const ordered = this.plugin.settings.highlighterOrder.length > 0
      ? this.plugin.settings.highlighterOrder
      : Object.keys(this.plugin.settings.highlighters);
    return ordered.filter((highlighter) => this.plugin.settings.highlighterActivity?.[highlighter] === false);
  }

  private async confirmPermanentDeletion(): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new DeleteHighlighterModal(this.app, (confirmed) => resolve(confirmed));
      modal.open();
    });
  }

  private getClassTokens(markTag: string): string[] {
    const classMatch = markTag.match(/\bclass\s*=\s*(["'])(.*?)\1/i);
    if (!classMatch || !classMatch[2]) {
      return [];
    }
    return classMatch[2]
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
  }

  private getInlineHltrColor(markTag: string): string | null {
    const styleMatch = markTag.match(/\bstyle\s*=\s*(["'])(.*?)\1/i);
    if (!styleMatch || !styleMatch[2]) {
      return null;
    }
    const colorMatch = styleMatch[2].match(/--hltr-color\s*:\s*([^;]+)/i);
    return colorMatch?.[1]?.trim() ?? null;
  }

  private async scanClassConflictSummary(classToken: string): Promise<ClassConflictSummary> {
    const files = this.app.vault.getMarkdownFiles();
    let totalMarks = 0;
    let fileCount = 0;
    const inlineColorCounts: Record<string, number> = {};
    const fileMatches: Array<{ path: string; marks: number }> = [];

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const markTags = content.match(/<mark\b[^>]*>/gi) ?? [];
      let fileMatchCount = 0;

      markTags.forEach((markTag) => {
        const classTokens = this.getClassTokens(markTag);
        if (classTokens.indexOf(classToken) === -1) {
          return;
        }
        fileMatchCount += 1;
        totalMarks += 1;
        const color = this.getInlineHltrColor(markTag);
        if (!color) {
          return;
        }
        inlineColorCounts[color] = (inlineColorCounts[color] ?? 0) + 1;
      });

      if (fileMatchCount > 0) {
        fileCount += 1;
        fileMatches.push({ path: file.path, marks: fileMatchCount });
      }
    }

    const topFiles = fileMatches
      .sort((a, b) => b.marks - a.marks)
      .slice(0, 5);

    return {
      classToken,
      totalMarks,
      fileCount,
      inlineColorCounts,
      topFiles,
    };
  }

  private async confirmClassConflict(
    summary: ClassConflictSummary,
    colorName: string,
    targetColorHex: string,
  ): Promise<ConflictAction> {
    return new Promise((resolve) => {
      const modal = new HighlighterClassConflictModal(
        this.app,
        summary,
        colorName,
        targetColorHex,
        (action) => resolve(action),
      );
      modal.open();
    });
  }

  private async setHighlighterActivity(highlighter: string, active: boolean): Promise<void> {
    this.plugin.settings.highlighterActivity[highlighter] = active;
    await this.plugin.saveSettings();
    window.setTimeout(() => {
      dispatchEvent(new Event("Highlightr-NewCommand"));
    }, 100);
  }

  private getHighlighterHotkeyLabel(highlighter: string): string | null {
    const commandId = `highlightr-plugin:${highlighter}`;
    const appWithHotkeys = this.app as App & {
      hotkeyManager?: {
        getHotkeys?: (commandId: string) => Array<{ modifiers?: string[]; key?: string }>;
        printHotkey?: (hotkey: unknown) => string;
      };
    };
    const hotkeyManager = appWithHotkeys.hotkeyManager;

    if (!hotkeyManager || typeof hotkeyManager.getHotkeys !== "function") {
      return null;
    }

    const hotkeys = hotkeyManager.getHotkeys(commandId);
    if (!hotkeys || hotkeys.length === 0) {
      return null;
    }

    const firstHotkey = hotkeys[0];

    if (typeof hotkeyManager.printHotkey === "function") {
      return hotkeyManager.printHotkey(firstHotkey);
    }

    const modifiers = Array.isArray(firstHotkey.modifiers) ? firstHotkey.modifiers : [];
    const key = firstHotkey.key ?? "";
    const parts = [...modifiers, key].filter(Boolean);
    return parts.length ? parts.join("+") : null;
  }

  private removeHighlighterCommand(highlighter: string): void {
    const appWithCommands = this.app as App & {
      commands?: {
        removeCommand?: (commandId: string) => void;
      };
    };
    appWithCommands.commands?.removeCommand?.(`highlightr-plugin:${highlighter}`);
  }

  private async handleDeleteHighlighter(highlighter: string, isActive: boolean): Promise<void> {
    if (isActive) {
      await this.setHighlighterActivity(highlighter, false);
      this.removeHighlighterCommand(highlighter);
      new Notice(`${highlighter} highlight moved to inactive`);
      this.display();
      return;
    }

    const confirmed = await this.confirmPermanentDeletion();
    if (!confirmed) {
      return;
    }

    this.removeHighlighterCommand(highlighter);
    delete this.plugin.settings.highlighters[highlighter];
    delete this.plugin.settings.highlighterClasses[highlighter];
    delete this.plugin.settings.highlighterActivity[highlighter];
    this.plugin.settings.highlighterOrder.remove(highlighter);
    await this.plugin.saveSettings();
    window.setTimeout(() => {
      dispatchEvent(new Event("Highlightr-NewCommand"));
    }, 100);
    new Notice(`${highlighter} highlight permanently deleted`);
    this.display();
  }

  private async migrateClassHighlights(
    classToken: string,
    targetColorHex: string,
  ): Promise<{ fileCount: number; updatedMarks: number }> {
    const files = this.app.vault.getMarkdownFiles();
    let fileCount = 0;
    let updatedMarks = 0;

    for (const file of files) {
      const content = await this.app.vault.read(file);
      let fileUpdatedMarks = 0;
      const replaced = content.replace(/<mark\b[^>]*>/gi, (markTag) => {
        const classTokens = this.getClassTokens(markTag);
        if (classTokens.indexOf(classToken) === -1) {
          return markTag;
        }

        fileUpdatedMarks += 1;
        const styleMatch = markTag.match(/\bstyle\s*=\s*(["'])(.*?)\1/i);
        if (!styleMatch) {
          const insertAt = markTag.endsWith(">") ? markTag.length - 1 : markTag.length;
          return `${markTag.slice(0, insertAt)} style="--hltr-color: ${targetColorHex};"${markTag.slice(insertAt)}`;
        }

        const quote = styleMatch[1];
        const styleValue = styleMatch[2];
        let nextStyleValue = styleValue;

        if (/--hltr-color\s*:/i.test(styleValue)) {
          nextStyleValue = styleValue.replace(/--hltr-color\s*:\s*[^;]+/i, `--hltr-color: ${targetColorHex}`);
        } else {
          const separator = styleValue.trim().length === 0 || styleValue.trim().endsWith(";") ? "" : ";";
          nextStyleValue = `${styleValue}${separator} --hltr-color: ${targetColorHex};`;
        }

        return markTag.replace(styleMatch[0], `style=${quote}${nextStyleValue}${quote}`);
      });

      if (fileUpdatedMarks > 0 && replaced !== content) {
        if (file instanceof TFile) {
          await this.app.vault.modify(file, replaced);
          fileCount += 1;
          updatedMarks += fileUpdatedMarks;
        }
      }
    }

    return { fileCount, updatedMarks };
  }

  private async saveHighlighter(
    colorName: string,
    colorHex: string,
    className: string,
  ): Promise<void> {
    const existingIndex = this.plugin.settings.highlighterOrder.indexOf(colorName);
    if (existingIndex === -1) {
      this.plugin.settings.highlighterOrder.push(colorName);
    }
    this.plugin.settings.highlighters[colorName] = colorHex;
    this.plugin.settings.highlighterClasses[colorName] = className;
    this.plugin.settings.highlighterActivity[colorName] = true;
    window.setTimeout(() => {
      dispatchEvent(new Event("Highlightr-NewCommand"));
    }, 100);
    await this.plugin.saveSettings();
    this.display();
  }

  private renderHighlighterItem(container: HTMLElement, highlighter: string, isActive: boolean): void {
    const settingItem = container.createEl("div");
    settingItem.addClass("highlighter-item-draggable");
    const colorIcon = settingItem.createEl("span");
    colorIcon.addClass("highlighter-setting-icon");
    const svgIcon = activeDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgIcon.setAttribute("viewBox", "0 0 24 24");
    svgIcon.setAttribute("fill", this.plugin.settings.highlighters[highlighter]);
    svgIcon.setAttribute("stroke", this.plugin.settings.highlighters[highlighter]);
    svgIcon.setAttribute("stroke-width", "0");
    svgIcon.setAttribute("stroke-linecap", "round");
    svgIcon.setAttribute("stroke-linejoin", "round");
    const svgPath = activeDocument.createElementNS("http://www.w3.org/2000/svg", "path");
    svgPath.setAttribute("d", "M20.707 5.826l-3.535-3.533a.999.999 0 0 0-1.408-.006L7.096 10.82a1.01 1.01 0 0 0-.273.488l-1.024 4.437L4 18h2.828l1.142-1.129l3.588-.828c.18-.042.345-.133.477-.262l8.667-8.535a1 1 0 0 0 .005-1.42zm-9.369 7.833l-2.121-2.12l7.243-7.131l2.12 2.12l-7.242 7.131zM4 20h16v2H4z");
    svgIcon.appendChild(svgPath);
    colorIcon.appendChild(svgIcon);

    const highlighterClassName = this.plugin.settings.highlighterClasses?.[highlighter] || createDefaultHighlighterClass(highlighter);
    const highlighterSettingItem = new Setting(settingItem)
      .setClass("highlighter-setting-item")
      .setName(highlighter)
      .setDesc(this.plugin.settings.highlighters[highlighter]);

    highlighterSettingItem.infoEl.createEl("div", {
      cls: "highlighter-setting-classname",
      text: `class="hltr-${highlighterClassName.toLowerCase()}"`,
    });

    const hotkeyLabel = this.getHighlighterHotkeyLabel(highlighter);
    if (hotkeyLabel) {
      highlighterSettingItem.infoEl.createEl("div", {
        cls: "highlighter-setting-hotkey",
        text: hotkeyLabel,
      });
    }

    if (!isActive) {
      highlighterSettingItem
        .addButton((button) => {
          button
            .setClass("HighlightrSettingsButton")
            .setIcon("highlightr-add")
            .setTooltip("Reactivate")
            .onClick(async () => {
              await this.setHighlighterActivity(highlighter, true);
              new Notice(`${highlighter} highlight reactivated`);
              this.display();
            });
        });
    }

    highlighterSettingItem
      .addButton((button) => {
        button
          .setClass("HighlightrSettingsButton")
          .setClass("HighlightrSettingsButtonDelete")
          .setIcon("highlightr-delete")
          .setTooltip("Remove")
          .onClick(async () => {
            await this.handleDeleteHighlighter(highlighter, isActive);
          });
      });
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("Highlightr").setHeading();
    const createdBy = containerEl.createEl("p", { text: "Created by " });
    createdBy.createEl("a", {
      text: "Chetachi 👩🏽‍💻",
      href: "https://github.com/chetachiezikeuzor",
    });
    createdBy.createEl("span", { text: " and " });
    createdBy.createEl("a", {
      text: "Olivier 👨🏼‍💻",
      href: "https://github.com/bluelephant825",
    });
    new Setting(containerEl).setName("Plugin").setHeading();

    new Setting(containerEl)
      .setName("Choose highlight method")
      .setDesc(
        `Choose between highlighting with inline CSS or CSS classes. Please note that there are pros and cons to both choices. Inline CSS will keep you from being reliant on external CSS files if you choose to export your notes. CSS classes are more flexible and easier to customize.`
      )
      .addDropdown((dropdown) => {
        let methods: Record<string, string> = {};
        HIGHLIGHTER_METHODS.map((method) => (methods[method] = method));
        dropdown.addOptions(methods);
        dropdown
          .setValue(this.plugin.settings.highlighterMethods)
          .onChange((highlightrMethod) => {
            this.plugin.settings.highlighterMethods = highlightrMethod;
            window.setTimeout(() => {
              dispatchEvent(new Event("Highlightr-NewCommand"));
            }, 100);
            void this.plugin.saveSettings();
            void this.plugin.saveData(this.plugin.settings);
            this.display();
          });
      });

    const stylesSetting = new Setting(containerEl);

    stylesSetting
      .setName("Choose highlight style")
      .setDesc(
        `Depending on your design aesthetic, you may want to customize the style of your highlights. Choose from an assortment of different highlighter styles by using the dropdown. Depending on your theme, this plugin's CSS may be overriden.`
      )
      .addDropdown((dropdown) => {
        let styles: Record<string, string> = {};
        HIGHLIGHTER_STYLES.map((style) => (styles[style] = style));
        dropdown.addOptions(styles);
        dropdown
          .setValue(this.plugin.settings.highlighterStyle)
          .onChange((highlighterStyle) => {
            this.plugin.settings.highlighterStyle = highlighterStyle;
            void this.plugin.saveSettings();
            void this.plugin.saveData(this.plugin.settings);
            this.plugin.refresh();
          });
      });

    const styleDemo = () => {
      const demo = createEl("p");
      demo.addClass("highlightr-style-demo");

      const lowlight = createEl("span", { text: "Lowlight" });
      lowlight.setAttribute(
        "style",
        "background:#FFB7EACC;padding: .125em .125em;--lowlight-background: var(--background-primary);border-radius: 0;background-image: linear-gradient(360deg,rgba(255, 255, 255, 0) 40%,var(--lowlight-background) 40%) !important;"
      );
      demo.appendChild(lowlight);
      demo.appendChild(activeDocument.createTextNode(" "));

      const floating = createEl("span", { text: "Floating" });
      floating.setAttribute(
        "style",
        "background:#93C0FFCC;--floating-background: var(--background-primary);border-radius: 0;padding-bottom: 5px;background-image: linear-gradient(360deg,rgba(255, 255, 255, 0) 28%,var(--floating-background) 28%) !important;"
      );
      demo.appendChild(floating);
      demo.appendChild(activeDocument.createTextNode(" "));

      const realistic = createEl("span", { text: "Realistic" });
      realistic.setAttribute(
        "style",
        "background:#9CF09CCC;margin: 0 -0.05em;padding: 0.1em 0.4em;border-radius: 0.8em 0.3em;-webkit-box-decoration-break: clone;box-decoration-break: clone;text-shadow: 0 0 0.75em var(--background-primary-alt);"
      );
      demo.appendChild(realistic);
      demo.appendChild(activeDocument.createTextNode(" "));

      const rounded = createEl("span", { text: "Rounded" });
      rounded.setAttribute(
        "style",
        "background:#CCA9FFCC;margin: 0 -0.05em;padding: 0.125em 0.15em;border-radius: 0.2em;-webkit-box-decoration-break: clone;box-decoration-break: clone;"
      );
      demo.appendChild(rounded);

      return demo;
    };

    stylesSetting.infoEl.appendChild(styleDemo());

    const highlighterSetting = new Setting(containerEl);

    highlighterSetting
      .setName("Choose highlight colors")
      .setClass("highlighterplugin-setting-item")
      .setDesc(
        `Create new highlight colors by providing a color name and using the color picker to set the hex code value. Don't forget to save the color before exiting the color picker. Drag and drop the highlight color to change the order for your highlighter component.`
      );

    const colorInput = new TextComponent(highlighterSetting.controlEl);
    colorInput.setPlaceholder("Color name");
    colorInput.inputEl.addClass("highlighter-settings-color");

    const classInput = new TextComponent(highlighterSetting.controlEl);
    classInput.setPlaceholder("Class name");
    classInput.inputEl.addClass("highlighter-settings-class");

    const valueInput = new TextComponent(highlighterSetting.controlEl);
    valueInput.setPlaceholder("Color hex code");
    valueInput.inputEl.addClass("highlighter-settings-value");

    highlighterSetting
      .addButton((button) => {
        button.setClass("highlightr-color-picker");
      })
      .then(() => {
        let input = valueInput.inputEl;

    const colorMap = this.plugin.settings.highlighterOrder
      .map((highlightKey) => this.plugin.settings.highlighters[highlightKey])
      .filter((value) => typeof value === "string" && value.length > 0);


        let colorHex;
        let pickrCreate = new Pickr({
          el: ".highlightr-color-picker",
          theme: "nano",
          swatches: colorMap,
          defaultRepresentation: "HEXA",
          default: colorMap[colorMap.length - 1],
          comparison: false,
          components: {
            preview: true,
            opacity: true,
            hue: true,
            interaction: {
              hex: true,
              rgba: true,
              hsla: false,
              hsva: false,
              cmyk: false,
              input: true,
              clear: true,
              cancel: true,
              save: true,
            },
          },
        });

        pickrCreate
          .on("clear", function (instance: Pickr) {
            instance.hide();
            input.trigger("change");
          })
          .on("cancel", function (instance: Pickr) {
            input.trigger("change");
            instance.hide();
          })
          .on("change", function (color: Pickr.HSVaColor) {
            colorHex = color.toHEXA().toString();
            let newColor;
            if (colorHex.length == 6) {
              newColor = `${color.toHEXA().toString()}A6`;
            } else {
              newColor = color.toHEXA().toString();
            }
            colorInput.inputEl.setAttribute(
              "style",
              `background-color: ${newColor}; color: var(--text-normal);`
            );

            setAttributes(input, {
              value: newColor,
              style: `background-color: ${newColor}; color: var(--text-normal);`,
            });
            input.setText(newColor);
            input.textContent = newColor;
            input.value = newColor;
            input.trigger("change");
          })
          .on("save", function (color: Pickr.HSVaColor, instance: Pickr) {
            let newColorValue = color.toHEXA().toString();

            input.setText(newColorValue);
            input.textContent = newColorValue;
            input.value = newColorValue;
            input.trigger("change");

            instance.hide();
            instance.addSwatch(color.toHEXA().toString());
          });
      })
      .addButton((button) => {
        button
          .setClass("HighlightrSettingsButton")
          .setClass("HighlightrSettingsButtonAdd")
          .setIcon("highlightr-save")
          .setTooltip("Save")
          .onClick(async (buttonEl: MouseEvent) => {
            let color = colorInput.inputEl.value.replace(" ", "-");
            let customClass = classInput.inputEl.value.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "");
            let value = valueInput.inputEl.value;

            if (color && value) {
              const existingIndex = this.plugin.settings.highlighterOrder.indexOf(color);
              if (existingIndex === -1 || this.plugin.settings.highlighterActivity?.[color] === false) {
                const className = customClass || createDefaultHighlighterClass(color);
                const classToken = `hltr-${className.toLowerCase()}`;
                if (this.plugin.settings.highlighterMethods === "css-classes") {
                  const summary = await this.scanClassConflictSummary(classToken);
                  if (summary.totalMarks > 0) {
                    const action = await this.confirmClassConflict(summary, color, value);
                    if (action === "rename") {
                      new Notice("Choose a different highlight name or class to keep both colors.");
                      return;
                    }
                    if (action === "reuse-with-migration") {
                      const migration = await this.migrateClassHighlights(classToken, value);
                      new Notice(`Updated ${migration.updatedMarks} highlight(s) across ${migration.fileCount} file(s).`);
                    }
                  }
                }
                await this.saveHighlighter(color, value, className);
                return;
              }
              buttonEl.stopImmediatePropagation();
              new Notice("This color already exists");
              return;
            }
            if (color && !value) {
              new Notice("Highlighter hex code missing");
            } else if (!color && value) {
              new Notice("Highlighter name missing");
            } else {
              new Notice("Highlighter values missing");
            }
          });
      });

    const activeHeader = new Setting(containerEl)
      .setName("Active highlight colors")
      .setHeading();
    activeHeader.setClass("highlightr-section-heading");

    const activeContainer = containerEl.createEl("div", {
      cls: "HighlightrSettingsTabsContainer",
    });

    Sortable.create(activeContainer, {
      animation: 500,
      ghostClass: "highlighter-sortable-ghost",
      chosenClass: "highlighter-sortable-chosen",
      dragClass: "highlighter-sortable-drag",
      dragoverBubble: true,
      forceFallback: true,
      fallbackClass: "highlighter-sortable-fallback",
      easing: "cubic-bezier(1, 0, 0, 1)",
      onSort: (command: Sortable.SortableEvent) => {
        const oldIndex = command.oldIndex;
        const newIndex = command.newIndex;
        if (oldIndex == null || newIndex == null) {
          return;
        }
        const active = this.getActiveHighlighters();
        const moved = active[oldIndex];
        const anchor = active[newIndex];
        if (!moved || !anchor) {
          return;
        }

        const order = [...this.plugin.settings.highlighterOrder];
        const from = order.indexOf(moved);
        const to = order.indexOf(anchor);
        if (from === -1 || to === -1) {
          return;
        }

        order.splice(from, 1);
        order.splice(to, 0, moved);
        this.plugin.settings.highlighterOrder = order;
        void this.plugin.saveSettings();
      },
    });

    this.getActiveHighlighters().forEach((highlighter) => {
      this.renderHighlighterItem(activeContainer, highlighter, true);
    });

    const inactiveHeader = new Setting(containerEl)
      .setName("Inactive highlight colors")
      .setHeading();
    inactiveHeader.setClass("highlightr-section-heading");

    const inactiveContainer = containerEl.createEl("div", {
      cls: "HighlightrSettingsTabsContainer",
    });

    this.getInactiveHighlighters().forEach((highlighter) => {
      this.renderHighlighterItem(inactiveContainer, highlighter, false);
    });
    const hltrDonationDiv = containerEl.createEl("div", {
      cls: "hltrDonationSection",
    });

    const donateText = createEl("p");
    donateText.appendText(
      "If you like this Plugin and are considering donating to support continued development, use the buttons below!"
    );
    hltrDonationDiv.appendChild(donateText);
    const donateToChetachi = createEl("div");
    new Setting(donateToChetachi).setName("Donate to Chetachi").setHeading();
    hltrDonationDiv.appendChild(donateToChetachi);
    hltrDonationDiv.appendChild(
      paypalButton("https://paypal.me/chelseaezikeuzor")
    );
    hltrDonationDiv.appendChild(
      buyMeACoffeeButton("https://www.buymeacoffee.com/chetachi")
    );
    hltrDonationDiv.appendChild(kofiButton("https://ko-fi.com/chetachi"));
    const donateToOlivier = createEl("div");
    donateToOlivier.addClass("hltrDonationHeadingSpacing");
    new Setting(donateToOlivier).setName("Donate to Olivier").setHeading();
    hltrDonationDiv.appendChild(donateToOlivier);
    hltrDonationDiv.appendChild(
      paypalButton("https://paypal.me/odebroqueville")
    );
  }
}

const buyMeACoffeeButton = (link: string): HTMLElement => {
  const a = createEl("a");
  a.setAttribute("href", link);
  a.addClass("buymeacoffee-chetachi-img");

  const img = createEl("img", {
    attr: {
      src: "https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=chetachi&button_colour=e3e7ef&font_colour=262626&font_family=Poppins&outline_colour=262626&coffee_colour=ff0000",
      height: "42",
      alt: "Buy me a coffee",
    },
  });

  a.appendChild(img);
  return a;
};

const paypalButton = (link: string): HTMLElement => {
  const a = createEl("a");
  a.setAttribute("href", link);
  a.addClass("buymeacoffee-chetachi-img");

  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="40"><path fill="#253B80" d="M46.211 6.749h-6.839a.95.95 0 0 0-.939.802l-2.766 17.537a.57.57 0 0 0 .564.658h3.265a.95.95 0 0 0 .939-.803l.746-4.73a.95.95 0 0 1 .938-.803h2.165c4.505 0 7.105-2.18 7.784-6.5.306-1.89.013-3.375-.872-4.415-.972-1.142-2.696-1.746-4.985-1.746zM47 13.154c-.374 2.454-2.249 2.454-4.062 2.454h-1.032l.724-4.583a.57.57 0 0 1 .563-.481h.473c1.235 0 2.4 0 3.002.704.359.42.469 1.044.332 1.906zM66.654 13.075h-3.275a.57.57 0 0 0-.563.481l-.145.916-.229-.332c-.709-1.029-2.29-1.373-3.868-1.373-3.619 0-6.71 2.741-7.312 6.586-.313 1.918.132 3.752 1.22 5.031.998 1.176 2.426 1.666 4.125 1.666 2.916 0 4.533-1.875 4.533-1.875l-.146.91a.57.57 0 0 0 .562.66h2.95a.95.95 0 0 0 .939-.803l1.77-11.209a.568.568 0 0 0-.561-.658zm-4.565 6.374c-.316 1.871-1.801 3.127-3.695 3.127-.951 0-1.711-.305-2.199-.883-.484-.574-.668-1.391-.514-2.301.295-1.855 1.805-3.152 3.67-3.152.93 0 1.686.309 2.184.892.499.589.697 1.411.554 2.317zM84.096 13.075h-3.291a.954.954 0 0 0-.787.417l-4.539 6.686-1.924-6.425a.953.953 0 0 0-.912-.678h-3.234a.57.57 0 0 0-.541.754l3.625 10.638-3.408 4.811a.57.57 0 0 0 .465.9h3.287a.949.949 0 0 0 .781-.408l10.946-15.8a.57.57 0 0 0-.468-.895z"/><path fill="#179BD7" d="M94.992 6.749h-6.84a.95.95 0 0 0-.938.802l-2.766 17.537a.569.569 0 0 0 .562.658h3.51a.665.665 0 0 0 .656-.562l.785-4.971a.95.95 0 0 1 .938-.803h2.164c4.506 0 7.105-2.18 7.785-6.5.307-1.89.012-3.375-.873-4.415-.971-1.142-2.694-1.746-4.983-1.746zm.789 6.405c-.373 2.454-2.248 2.454-4.062 2.454h-1.031l.725-4.583a.568.568 0 0 1 .562-.481h.473c1.234 0 2.4 0 3.002.704.359.42.468 1.044.331 1.906zM115.434 13.075h-3.273a.567.567 0 0 0-.562.481l-.145.916-.23-.332c-.709-1.029-2.289-1.373-3.867-1.373-3.619 0-6.709 2.741-7.311 6.586-.312 1.918.131 3.752 1.219 5.031 1 1.176 2.426 1.666 4.125 1.666 2.916 0 4.533-1.875 4.533-1.875l-.146.91a.57.57 0 0 0 .564.66h2.949a.95.95 0 0 0 .938-.803l1.771-11.209a.571.571 0 0 0-.565-.658zm-4.565 6.374c-.314 1.871-1.801 3.127-3.695 3.127-.949 0-1.711-.305-2.199-.883-.484-.574-.666-1.391-.514-2.301.297-1.855 1.805-3.152 3.67-3.152.93 0 1.686.309 2.184.892.501.589.699 1.411.554 2.317zM119.295 7.23l-2.807 17.858a.569.569 0 0 0 .562.658h2.822c.469 0 .867-.34.939-.803l2.768-17.536a.57.57 0 0 0-.562-.659h-3.16a.571.571 0 0 0-.562.482z"/><path fill="#253B80" d="M7.266 29.154l.523-3.322-1.165-.027H1.061L4.927 1.292a.316.316 0 0 1 .314-.268h9.38c3.114 0 5.263.648 6.385 1.927.526.6.861 1.227 1.023 1.917.17.724.173 1.589.007 2.644l-.012.077v.676l.526.298a3.69 3.69 0 0 1 1.065.812c.45.513.741 1.165.864 1.938.127.795.085 1.741-.123 2.812-.24 1.232-.628 2.305-1.152 3.183a6.547 6.547 0 0 1-1.825 2c-.696.494-1.523.869-2.458 1.109-.906.236-1.939.355-3.072.355h-.73c-.522 0-1.029.188-1.427.525a2.21 2.21 0 0 0-.744 1.328l-.055.299-.924 5.855-.042.215c-.011.068-.03.102-.058.125a.155.155 0 0 1-.096.035H7.266z"/><path fill="#179BD7" d="M23.048 7.667c-.028.179-.06.362-.096.55-1.237 6.351-5.469 8.545-10.874 8.545H9.326c-.661 0-1.218.48-1.321 1.132L6.596 26.83l-.399 2.533a.704.704 0 0 0 .695.814h4.881c.578 0 1.069-.42 1.16-.99l.048-.248.919-5.832.059-.32c.09-.572.582-.992 1.16-.992h.73c4.729 0 8.431-1.92 9.513-7.476.452-2.321.218-4.259-.978-5.622a4.667 4.667 0 0 0-1.336-1.03z"/><path fill="#222D65" d="M21.754 7.151a9.757 9.757 0 0 0-1.203-.267 15.284 15.284 0 0 0-2.426-.177h-7.352a1.172 1.172 0 0 0-1.159.992L8.05 17.605l-.045.289a1.336 1.336 0 0 1 1.321-1.132h2.752c5.405 0 9.637-2.195 10.874-8.545.037-.188.068-.371.096-.55a6.594 6.594 0 0 0-1.017-.429 9.045 9.045 0 0 0-.277-.087z"/><path fill="#253B80" d="M9.614 7.699a1.169 1.169 0 0 1 1.159-.991h7.352c.871 0 1.684.057 2.426.177a9.757 9.757 0 0 1 1.481.353c.365.121.704.264 1.017.429.368-2.347-.003-3.945-1.272-5.392C20.378.682 17.853 0 14.622 0h-9.38c-.66 0-1.223.48-1.325 1.133L.01 25.898a.806.806 0 0 0 .795.932h5.791l1.454-9.225 1.564-9.906z"/></svg>`;
  const img = createEl("img", {
    attr: {
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`,
      height: "40",
      alt: "PayPal button",
    },
  });
  a.appendChild(img);
  return a;
};

const kofiButton = (link: string): HTMLElement => {
  const a = createEl("a");
  a.setAttribute("href", link);
  a.addClass("buymeacoffee-chetachi-img");
  const img = createEl("img", {
    attr: {
      src: "https://raw.githubusercontent.com/chetachiezikeuzor/Highlightr-Plugin/master/assets/kofi_color.svg",
      height: "50",
      alt: "Ko-fi button",
    },
  });
  a.appendChild(img);
  return a;
};
