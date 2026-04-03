import {
  CodeAction,
  CodeActionKind,
  Diagnostic,
  TextEdit,
  Position,
} from "vscode-languageserver/node";
import type { CatalogProvider } from "./catalogProvider.js";

/**
 * Produce quick-fix code actions for catalog diagnostics.
 *
 * Currently handled diagnostics:
 *  - "Column 'Y' does not exist in table 'Z'"  ->  ALTER TABLE ... ADD
 *  - "Table 'X' does not exist"                 ->  CREATE TABLE template
 */
export function getCodeActions(
  diagnostics: Diagnostic[],
  text: string,
  uri: string,
  _catalog?: CatalogProvider,
): CodeAction[] {
  const actions: CodeAction[] = [];
  const lines = text.split("\n");
  const lastLine = lines.length;

  for (const diag of diagnostics) {
    if (diag.source !== "plsql-lsp(catalog)") continue;

    // Match "Column 'X' does not exist in table 'Y'"
    const colMatch = diag.message.match(
      /Column '([^']+)' does not exist in table '([^']+)'/i,
    );
    if (colMatch) {
      const [, colName, tableName] = colMatch;
      const insertText = `\nALTER TABLE ${tableName} ADD (${colName} VARCHAR2(100));\n`;
      actions.push({
        title: `Add column ${colName} to ${tableName}`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diag],
        edit: {
          changes: {
            [uri]: [
              TextEdit.insert(Position.create(lastLine, 0), insertText),
            ],
          },
        },
      });
      continue;
    }

    // Match "Table 'X' does not exist"
    const tableMatch = diag.message.match(/Table '([^']+)' does not exist/i);
    if (tableMatch) {
      const [, tableName] = tableMatch;
      const insertText = `\nCREATE TABLE ${tableName} (\n  id NUMBER PRIMARY KEY\n);\n`;
      actions.push({
        title: `Create table ${tableName}`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diag],
        edit: {
          changes: {
            [uri]: [
              TextEdit.insert(Position.create(lastLine, 0), insertText),
            ],
          },
        },
      });
    }
  }

  return actions;
}
