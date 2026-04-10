import { Menu, type BrowserWindow, type ContextMenuParams } from "electron";
import { buildContextMenuTemplate } from "./context-menu-core.js";

export function registerWindowContextMenu(win: BrowserWindow): void {
  win.webContents.on("context-menu", (_event, params: ContextMenuParams) => {
    const template = buildContextMenuTemplate(params, {
      replaceMisspelling: (word) => win.webContents.replaceMisspelling(word),
      addWordToDictionary: (word) => {
        win.webContents.session.addWordToSpellCheckerDictionary(word);
      },
    });

    if (template.length === 0) return;

    Menu.buildFromTemplate(template).popup({ window: win });
  });
}
