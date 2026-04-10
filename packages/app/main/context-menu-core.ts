import type { MenuItemConstructorOptions } from "electron";

type EditFlags = {
  canUndo?: boolean;
  canRedo?: boolean;
  canCut?: boolean;
  canCopy?: boolean;
  canPaste?: boolean;
  canDelete?: boolean;
  canSelectAll?: boolean;
};

export type ContextMenuParamsLike = {
  isEditable: boolean;
  selectionText?: string;
  misspelledWord?: string;
  dictionarySuggestions?: string[];
  editFlags?: EditFlags;
};

export type ContextMenuActions = {
  replaceMisspelling: (word: string) => void;
  addWordToDictionary: (word: string) => void;
};

export function buildContextMenuTemplate(
  params: ContextMenuParamsLike,
  actions: ContextMenuActions
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  const selectionText = params.selectionText?.trim() ?? "";
  const misspelledWord = params.misspelledWord?.trim() ?? "";
  const suggestions = params.dictionarySuggestions ?? [];
  const flags = params.editFlags ?? {};

  if (misspelledWord) {
    if (suggestions.length > 0) {
      for (const suggestion of suggestions) {
        template.push({
          label: suggestion,
          click: () => actions.replaceMisspelling(suggestion),
        });
      }
    } else {
      template.push({
        label: "No Spelling Suggestions",
        enabled: false,
      });
    }

    template.push({
      label: "Add to Dictionary",
      click: () => actions.addWordToDictionary(misspelledWord),
    });
    template.push({ type: "separator" });
  }

  if (params.isEditable) {
    template.push(
      { role: "undo", enabled: Boolean(flags.canUndo) },
      { role: "redo", enabled: Boolean(flags.canRedo) },
      { type: "separator" },
      { role: "cut", enabled: Boolean(flags.canCut) },
      { role: "copy", enabled: Boolean(flags.canCopy) },
      { role: "paste", enabled: Boolean(flags.canPaste) },
      { role: "delete", enabled: Boolean(flags.canDelete) },
      { type: "separator" },
      { role: "selectAll", enabled: Boolean(flags.canSelectAll) }
    );
  } else if (selectionText) {
    template.push({ role: "copy", enabled: Boolean(flags.canCopy || selectionText) });
  }

  return compactSeparators(template);
}

function compactSeparators(
  template: MenuItemConstructorOptions[]
): MenuItemConstructorOptions[] {
  const compacted: MenuItemConstructorOptions[] = [];

  for (const item of template) {
    if (item.type === "separator") {
      if (compacted.length === 0) continue;
      if (compacted[compacted.length - 1]?.type === "separator") continue;
    }
    compacted.push(item);
  }

  while (compacted.at(-1)?.type === "separator") {
    compacted.pop();
  }

  return compacted;
}
