import { SyntaxNode } from "./parser/ast.js";
import {
  buildSymbolTable,
  findScopeAtPosition,
  resolveReferences,
  Scope,
  SymbolInfo,
} from "./symbolTable.js";

// ─── Helpers (copied from definition.ts) ─────────────────────────────────

function isIdentChar(ch: number): boolean {
  // A-Z, a-z, 0-9, _, $, #
  return (
    (ch >= 65 && ch <= 90) ||
    (ch >= 97 && ch <= 122) ||
    (ch >= 48 && ch <= 57) ||
    ch === 95 || // _
    ch === 36 || // $
    ch === 35    // #
  );
}

function offsetToPosition(text: string, offset: number): { offset: number; line: number; col: number } {
  let line = 0;
  let lastNewline = -1;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastNewline = i;
    }
  }
  return { offset, line, col: offset - lastNewline - 1 };
}

// ─── Result type ────────────────────────────────────────────────────────

export interface LocationResult {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

// ─── Main ───────────────────────────────────────────────────────────────

export function getReferences(
  ast: SyntaxNode,
  text: string,
  offset: number,
  includeDeclaration: boolean,
): LocationResult[] {
  // 1. Find the identifier at cursor position
  let wordStart = offset;
  while (wordStart > 0 && isIdentChar(text.charCodeAt(wordStart - 1))) {
    wordStart--;
  }
  let wordEnd = offset;
  while (wordEnd < text.length && isIdentChar(text.charCodeAt(wordEnd))) {
    wordEnd++;
  }
  const word = text.slice(wordStart, wordEnd);
  if (word.length === 0) return [];

  // 2. Build symbol table and compute position
  const table = buildSymbolTable(ast);
  const position = offsetToPosition(text, offset);

  // 3. Resolve the identifier — walk scope chain
  const normalizedName = word.toUpperCase();
  const scope = findScopeAtPosition(table, position);
  let sym: SymbolInfo | undefined;
  let current: Scope | null = scope;
  while (current !== null) {
    sym = current.symbols.get(normalizedName);
    if (sym) break;
    current = current.parent;
  }

  if (!sym) return [];

  // 4. Resolve all references in the file
  const refResult = resolveReferences(ast, table);

  // 5. Collect locations
  const locations: LocationResult[] = [];

  // If includeDeclaration, add the symbol's declaration location
  if (includeDeclaration) {
    locations.push({
      range: {
        start: { line: sym.nameRange.start.line, character: sym.nameRange.start.col },
        end: { line: sym.nameRange.end.line, character: sym.nameRange.end.col },
      },
    });
  }

  // 6. Add all usage references for this symbol
  const refs = refResult.symbolReferences.get(sym);
  if (refs) {
    for (const ref of refs) {
      locations.push({
        range: {
          start: { line: ref.range.start.line, character: ref.range.start.col },
          end: { line: ref.range.end.line, character: ref.range.end.col },
        },
      });
    }
  }

  return locations;
}
