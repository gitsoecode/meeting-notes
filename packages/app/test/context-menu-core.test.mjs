import test from "node:test";
import assert from "node:assert/strict";
import { buildContextMenuTemplate } from "../dist/main/context-menu-core.js";

test("buildContextMenuTemplate includes spelling suggestions and dictionary action", () => {
  const replaced = [];
  const added = [];
  const template = buildContextMenuTemplate(
    {
      isEditable: true,
      misspelledWord: "teh",
      dictionarySuggestions: ["the", "tech"],
      editFlags: {
        canUndo: true,
        canRedo: false,
        canCut: true,
        canCopy: true,
        canPaste: true,
        canDelete: true,
        canSelectAll: true,
      },
    },
    {
      replaceMisspelling: (word) => replaced.push(word),
      addWordToDictionary: (word) => added.push(word),
    }
  );

  assert.equal(template[0]?.label, "the");
  template[0]?.click?.();
  assert.deepEqual(replaced, ["the"]);

  assert.equal(template[1]?.label, "tech");
  assert.equal(template[2]?.label, "Add to Dictionary");
  template[2]?.click?.();
  assert.deepEqual(added, ["teh"]);

  assert.equal(template.some((item) => item.role === "paste"), true);
  assert.equal(template.at(-1)?.role, "selectAll");
});

test("buildContextMenuTemplate offers copy for selected read-only text without extra separators", () => {
  const template = buildContextMenuTemplate(
    {
      isEditable: false,
      selectionText: "Selected transcript line",
      editFlags: {
        canCopy: true,
      },
    },
    {
      replaceMisspelling: () => {},
      addWordToDictionary: () => {},
    }
  );

  assert.deepEqual(
    template.map((item) => item.type ?? item.role ?? item.label),
    ["copy"]
  );
});

test("buildContextMenuTemplate omits empty menus", () => {
  const template = buildContextMenuTemplate(
    {
      isEditable: false,
      selectionText: "   ",
      misspelledWord: "",
    },
    {
      replaceMisspelling: () => {},
      addWordToDictionary: () => {},
    }
  );

  assert.deepEqual(template, []);
});
