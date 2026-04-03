import { SyntaxNode } from "./parser/ast.js";
import {
  buildSymbolTable,
  findScopeAtPosition,
  resolveReferences,
  Scope,
  SymbolInfo,
  SymbolTable,
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

export interface TextEditResult {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
}

// ─── Internals ──────────────────────────────────────────────────────────

/** Find the identifier word at cursor and resolve it to a symbol. */
function resolveIdentifierAtOffset(
  table: SymbolTable,
  text: string,
  offset: number,
): { sym: SymbolInfo; wordStart: number; wordEnd: number } | null {
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
  if (word.length === 0) return null;

  // 2. Compute position and resolve
  const position = offsetToPosition(text, offset);
  const normalizedName = word.toUpperCase();
  const scope = findScopeAtPosition(table, position);
  let sym: SymbolInfo | undefined;
  let current: Scope | null = scope;
  while (current !== null) {
    sym = current.symbols.get(normalizedName);
    if (sym) break;
    current = current.parent;
  }

  if (!sym) return null;

  return { sym, wordStart, wordEnd };
}

// ─── Main: getRenameEdits ───────────────────────────────────────────────

export function getRenameEdits(
  ast: SyntaxNode,
  text: string,
  offset: number,
  newName: string,
): TextEditResult[] {
  const table = buildSymbolTable(ast);
  const resolved = resolveIdentifierAtOffset(table, text, offset);
  if (!resolved) return [];

  const { sym } = resolved;

  // Resolve all references using the same symbol table
  const refResult = resolveReferences(ast, table);

  // Collect all locations to rename
  const edits: TextEditResult[] = [];

  // Add the declaration location
  edits.push({
    range: {
      start: { line: sym.nameRange.start.line, character: sym.nameRange.start.col },
      end: { line: sym.nameRange.end.line, character: sym.nameRange.end.col },
    },
    newText: newName,
  });

  // Add all usage references for this symbol
  const refs = refResult.symbolReferences.get(sym);
  if (refs) {
    for (const ref of refs) {
      edits.push({
        range: {
          start: { line: ref.range.start.line, character: ref.range.start.col },
          end: { line: ref.range.end.line, character: ref.range.end.col },
        },
        newText: newName,
      });
    }
  }

  return edits;
}

// ─── Prepare rename ─────────────────────────────────────────────────────

export function prepareRename(
  ast: SyntaxNode,
  text: string,
  offset: number,
): { range: { start: { line: number; character: number }; end: { line: number; character: number } }; placeholder: string } | null {
  const table = buildSymbolTable(ast);
  const resolved = resolveIdentifierAtOffset(table, text, offset);
  if (!resolved) return null;

  const { sym, wordStart, wordEnd } = resolved;

  const startPos = offsetToPosition(text, wordStart);
  const endPos = offsetToPosition(text, wordEnd);

  return {
    range: {
      start: { line: startPos.line, character: startPos.col },
      end: { line: endPos.line, character: endPos.col },
    },
    placeholder: sym.name,
  };
}
