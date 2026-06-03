# Highlightr Plus Plugin

<img src="assets/Highlightr Demo Header.png" style=" box-shadow: 0 2px 8px 0 var(--background-modifier-border); border-radius: 8px; ">

### Status: This plugin is currently available in the Obsidian plugin store

Highlightr Plus is a simple plugin that brings a minimal and aesthetically pleasing highlighting and annotating menu into the Obsidian note-taking app. This plugin makes color-coded highlighting much easier with a user-friendly assortment of highlight colors.

This plugin is based on Chetachi's original Highlightr plugin. The screenshots below are from the Highlightr plugin and the UI may be slightly different in Highlightr Plus, but the functionality is the same.

## Demo

<img src="https://user-images.githubusercontent.com/79069364/142739125-dad73e22-c6c4-4c49-8367-3e5a278659e7.gif" style=" box-shadow: 0 2px 8px 0 var(--background-modifier-border); border-radius: 8px; ">

## Ease of Use

Make beautiful highlights and add annotations with tags to your Obsidian notes to supplement your note-taking. The colors included were chosen to be universal across themes, in both light and dark mode. The use of inline CSS is essential in maintaining the longevity of your notes. When you export, you will not be reliant on any external CSS styling. This will make your notes much more flexible!

## How it Works

Although the plugin supplies you with a beautiful assortment of colors, you are free to customize your highlighter menu as you wish! Create new highlighter colors by openning the plugin settings tab. There, you will see an input, color picker and an `save` button. Use the input to set the name of your brand new highlight, then use the color picker to pick the color for said highlight. Then use the `save` button to save the new highlight into your highlighter menu.

<img src="https://user-images.githubusercontent.com/79069364/142739491-f6f75912-8689-4eef-a10e-67a820471d3c.png" style=" box-shadow: 0 2px 8px 0 var(--background-modifier-border); border-radius: 8px; ">

<img src="https://user-images.githubusercontent.com/79069364/142739119-be46413e-905a-47bb-a23b-a63babc586e1.gif" style=" box-shadow: 0 2px 8px 0 var(--background-modifier-border); border-radius: 8px; ">

This plugin adds different context menu items depending on where you right-click: Highlight, Change Highlight Color, Unhighlight, Annotate, Edit annotation and Erase annotation. These menu items can only be seen by right-clicking on text selection, a highlight or an annotation icon. Clicking "Highlight" will reveal the highlighting submenu, allowing you to choose from an assortment of colors. When you choose a color, your selected text will then be wrapped within HTML mark tags, including a color for the background that corresponds with the color you have chosen. Clicking "Unhighlight" will either remove the HTML mark tags and its style attribute if there are no annotations or just remove the style attribute if there are annotations. When adding an annotation, a data-note attribute is added to the HTML mark tag. If tags are added to the annotation, then a data-tags attribute to the HTML mark tag is also added. In addition, to these added attributes, annotations marked with a note icon placed right after the highlight or selected text followed by tags if there are any.

<img alt="highlightr-demo" src="https://user-images.githubusercontent.com/79069364/144176804-c63a7e8d-f27c-48a6-bfeb-484cfe7d44e6.gif" style=" box-shadow: 0 2px 8px 0 var(--background-modifier-border); border-radius: 8px; ">

<img src="https://user-images.githubusercontent.com/79069364/142739490-e6824979-c339-449e-88c2-051979b7a6aa.png" style=" box-shadow: 0 2px 8px 0 var(--background-modifier-border); border-radius: 8px; ">

You can also use the command palette or a hotkey of your choosing to open your highlighlighter menu. You will be able to add hotkeys to each individual highlighter color from your highlighter menu, as the plugin creates a command for each highlighter as well.

<img src="https://user-images.githubusercontent.com/79069364/142739122-aed7a0ee-e7d8-4595-90f5-9e809f44ef04.gif" style=" box-shadow: 0 2px 8px 0 var(--background-modifier-border); border-radius: 8px; ">

<img src="https://user-images.githubusercontent.com/79069364/142739489-8f1e3243-f07a-4b40-a9d7-9c36dd3a784b.png" style=" box-shadow: 0 2px 8px 0 var(--background-modifier-border); border-radius: 8px; ">

The plugin settings give you the ability to choose between 'inline CSS' and 'CSS classes' highlighting modes. The former will add a new style attribute whilst the latter will add a new class attribute with your chosen highlight color. Each class is named `hltr-${highlight_title_here}` by default and is generated from the title by which you have named your highlight color. Although inline CSS is highly encouraged, CSS classes will make your highlights much more flexible and easier to customize.

## Disclaimer

The plugin component will not work with [cMenu plugin](https://github.com/chetachiezikeuzor/cMenu-Plugin).

## Installation

This plugin is available in the Obsidian community plugin store. You can install it from there. For a manual installation, you can download the necessary files and place them within your .obsidian/plugins folder.

---

## Changes made to Chetachi's original Highlightr plugin

- created a submenu to pick the highlight color
- added an annotating menu which allows users to add a note and/or tags
- the context menu options differ depending where you right-click
- added a sidebar panel to display highlights, annotations and tags

---

## Checklist

- [x] Highlighter color commands
- [x] Open highlighter palette with command
- [x] Unhighlight with command
- [x] Undo highlight functionality
- [x] Customize highlighter colors
- [x] CSS classes setting

---

## Support

If you like this Plugin and are considering donating to support continued development, use the buttons below!

Created with ❤️ by Chetachi & Olivier

**Donate to Chetachi**
<br/>
<br/>
<a href="https://www.buymeacoffee.com/chetachi"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&amp;emoji=&amp;slug=chetachi&amp;button_colour=e3e7ef&amp;font_colour=262626&amp;font_family=Poppins&amp;outline_colour=262626&amp;coffee_colour=ff0000"></a>
<br/>
<br/>
<a href="https://paypal.me/chelseaezikeuzor">
<img src="https://raw.githubusercontent.com/chetachiezikeuzor/Highlightr-Plugin/master/assets/paypal.svg" height="50"></a>
<br/>
<a href="https://ko-fi.com/chetachi">
<img src="https://raw.githubusercontent.com/chetachiezikeuzor/Highlightr-Plugin/master/assets/kofi_color.svg" height="50"></a>


**Donate to Olivier**
<br />
<br/>
<a href="https://paypal.me/odebroqueville">
<img src="https://raw.githubusercontent.com/chetachiezikeuzor/Highlightr-Plugin/master/assets/paypal.svg" height="50"></a>