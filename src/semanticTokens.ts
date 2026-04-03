import { SyntaxNode } from "./parser/ast.js";
import { buildSymbolTable, resolveReferences, SymbolType } from "./symbolTable.js";
import type { SymbolInfo, Reference } from "./symbolTable.js";

// ---- Legend ----------------------------------------------------------------

export const tokenTypes = [
  "variable",      // 0 - variables, constants, for-loop vars
  "parameter",     // 1 - procedure/function parameters
  "function",      // 2 - functions
  "method",        // 3 - procedures (methods in LSP terminology)
  "type",          // 4 - types, subtypes
  "class",         // 5 - tables (mapped to class in LSP)
  "property",      // 6 - columns, record fields
  "event",         // 7 - exceptions
  "interface",     // 8 - cursors
  "label",         // 9 - labels
];

export const tokenModifiers = [
  "declaration",   // 0
  "readonly",      // 1 - constants
  "definition",    // 2
];

// ---- Mapping ---------------------------------------------------------------

function symbolTypeToTokenType(st: SymbolType): number {
  switch (st) {
    case SymbolType.Variable:
    case SymbolType.Constant:
    case SymbolType.ForLoopVariable:
      return 0;
    case SymbolType.Parameter:
      return 1;
    case SymbolType.Function:
      return 2;
    case SymbolType.Procedure:
      return 3;
    case SymbolType.Type:
    case SymbolType.Subtype:
      return 4;
    case SymbolType.RecordField:
      return 6;
    case SymbolType.Exception:
      return 7;
    case SymbolType.Cursor:
      return 8;
    case SymbolType.Label:
      return 9;
    default:
      return 0;
  }
}

// ---- Main ------------------------------------------------------------------

interface RawToken {
  line: number;
  col: number;
  length: number;
  tokenType: number;
  tokenModifiers: number;
}

export function getSemanticTokens(ast: SyntaxNode, _text: string): number[] {
  const table = buildSymbolTable(ast);
  const { references } = resolveReferences(ast, table);

  const raw: RawToken[] = [];

  // Declarations
  for (const sym of table.allSymbols) {
    const line = sym.nameRange.start.line;
    const col = sym.nameRange.start.col;
    const length = sym.nameRange.end.col - sym.nameRange.start.col;
    if (length <= 0) continue;

    let modBits = 1; // declaration
    if (sym.symbolType === SymbolType.Constant) {
      modBits |= 2; // readonly
    }

    raw.push({
      line,
      col,
      length,
      tokenType: symbolTypeToTokenType(sym.symbolType),
      tokenModifiers: modBits,
    });
  }

  // References
  for (const ref of references) {
    const line = ref.range.start.line;
    const col = ref.range.start.col;
    const length = ref.range.end.col - ref.range.start.col;
    if (length <= 0) continue;

    raw.push({
      line,
      col,
      length,
      tokenType: symbolTypeToTokenType(ref.resolvedSymbol.symbolType),
      tokenModifiers: 0,
    });
  }

  // Sort by (line, col)
  raw.sort((a, b) => a.line - b.line || a.col - b.col);

  // Delta encode
  const data: number[] = [];
  let prevLine = 0;
  let prevCol = 0;

  for (const tok of raw) {
    const deltaLine = tok.line - prevLine;
    const deltaCol = deltaLine === 0 ? tok.col - prevCol : tok.col;

    data.push(deltaLine, deltaCol, tok.length, tok.tokenType, tok.tokenModifiers);

    prevLine = tok.line;
    prevCol = tok.col;
  }

  return data;
}
