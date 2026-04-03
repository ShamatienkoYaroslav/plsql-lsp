import {
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticTag,
} from "vscode-languageserver/node";
import { SyntaxNode } from "./parser/ast.js";
import {
  buildSymbolTable,
  resolveReferences,
  SymbolType,
  SymbolInfo,
} from "./symbolTable.js";

const CHECKABLE_TYPES = new Set<SymbolType>([
  SymbolType.Variable,
  SymbolType.Constant,
  SymbolType.Parameter,
]);

export function getUnusedDiagnostics(
  ast: SyntaxNode,
  severity?: DiagnosticSeverity | null,
): Diagnostic[] {
  if (severity === null) return [];
  const effectiveSeverity = severity ?? DiagnosticSeverity.Hint;

  const table = buildSymbolTable(ast);
  const refResult = resolveReferences(ast, table);
  const diagnostics: Diagnostic[] = [];

  for (const sym of table.allSymbols) {
    if (!CHECKABLE_TYPES.has(sym.symbolType)) continue;

    const refs = refResult.symbolReferences.get(sym);
    if (refs && refs.length > 0) continue;

    diagnostics.push({
      range: {
        start: {
          line: sym.nameRange.start.line,
          character: sym.nameRange.start.col,
        },
        end: {
          line: sym.nameRange.end.line,
          character: sym.nameRange.end.col,
        },
      },
      message: `'${sym.name}' is declared but never used`,
      severity: effectiveSeverity,
      tags: [DiagnosticTag.Unnecessary],
      source: "plsql",
    });
  }

  return diagnostics;
}
