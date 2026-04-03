import { SyntaxNode } from "./parser/ast.js";
import {
  buildSymbolTable,
  resolveReferences,
  SymbolInfo,
  SymbolType,
} from "./symbolTable.js";
import { CodeLens, Command } from "vscode-languageserver/node";

// ─── Main ───────────────────────────────────────────────────────────────

export function getCodeLenses(ast: SyntaxNode, text: string, uri: string): CodeLens[] {
  const table = buildSymbolTable(ast);
  const refResult = resolveReferences(ast, table);
  const lenses: CodeLens[] = [];

  // Only show code lenses for top-level callable symbols (procedures, functions)
  for (const sym of table.allSymbols) {
    if (sym.symbolType !== SymbolType.Procedure && sym.symbolType !== SymbolType.Function) {
      continue;
    }

    const range = {
      start: { line: sym.nameRange.start.line, character: sym.nameRange.start.col },
      end: { line: sym.nameRange.end.line, character: sym.nameRange.end.col },
    };

    // "N references" lens
    const refs = refResult.symbolReferences.get(sym);
    const refCount = refs ? refs.length : 0;
    const refTitle = refCount === 1 ? "1 reference" : `${refCount} references`;

    lenses.push({
      range,
      command: {
        title: refTitle,
        command: "oradev.showReferences",
        arguments: [uri, range.start, sym.name],
      },
    });

    // "Run" lens for standalone procedures/functions (top-level scope, not inside a package)
    if (sym.scope.kind === "Script" || sym.scope.kind === "<global>") {
      if (sym.symbolType === SymbolType.Procedure) {
        lenses.push({
          range,
          command: {
            title: "Run",
            command: "oradev.runStatement",
            arguments: [uri, sym.name],
          },
        });
      }
    }
  }

  return lenses;
}
