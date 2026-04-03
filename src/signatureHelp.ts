import {
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
} from "vscode-languageserver/node";
import { SyntaxNode } from "./parser/ast.js";
import {
  buildSymbolTable,
  findScopeAtPosition,
  SymbolType,
  SymbolInfo,
  SymbolTable,
  Scope,
} from "./symbolTable.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

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

// ─── Call context detection ───────────────────────────────────────────────

interface CallContext {
  name: string;
  nameOffset: number;
  activeParameter: number;
}

function findCallContext(text: string, offset: number): CallContext | null {
  let depth = 0;
  let commas = 0;
  let inString = false;

  for (let i = offset - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "'") {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === ")") { depth++; continue; }
    if (ch === "(") {
      if (depth > 0) { depth--; continue; }
      // Found the opening paren -- find the identifier before it
      let nameEnd = i;
      // Skip whitespace before paren
      while (nameEnd > 0 && /\s/.test(text[nameEnd - 1])) nameEnd--;
      let nameStart = nameEnd;
      while (nameStart > 0 && isIdentChar(text.charCodeAt(nameStart - 1))) nameStart--;
      const name = text.slice(nameStart, nameEnd);
      if (name.length === 0) return null;
      return { name, nameOffset: nameStart, activeParameter: commas };
    }
    if (ch === ",") { commas++; }
  }
  return null;
}

// ─── Parameter extraction from symbol table ───────────────────────────────

function getParameterSymbols(table: SymbolTable, procSym: SymbolInfo): SymbolInfo[] {
  // Find the scope created for this procedure/function.
  // The scope's name matches the proc name and its range starts at the same offset
  // as the proc symbol's declaration range.
  const procScope = table.allScopes.find(
    s => s.name.toUpperCase() === procSym.normalizedName &&
         s.range.start.offset === procSym.range.start.offset,
  );
  if (!procScope) return [];
  // Collect Parameter symbols, sorted by offset
  return [...procScope.symbols.values()]
    .filter(s => s.symbolType === SymbolType.Parameter)
    .sort((a, b) => a.nameRange.start.offset - b.nameRange.start.offset);
}

// ─── Main ─────────────────────────────────────────────────────────────────

export function getSignatureHelp(ast: SyntaxNode, text: string, offset: number): SignatureHelp | null {
  // 1. Find the call context (function/procedure name and active parameter)
  const ctx = findCallContext(text, offset);
  if (!ctx) return null;

  // 2. Build symbol table and resolve the procedure/function
  const table = buildSymbolTable(ast);
  const position = offsetToPosition(text, ctx.nameOffset);
  const normalizedName = ctx.name.toUpperCase();
  const scope = findScopeAtPosition(table, position);

  let procSym: SymbolInfo | undefined;
  let current: Scope | null = scope;
  while (current !== null) {
    const sym = current.symbols.get(normalizedName);
    if (sym && (sym.symbolType === SymbolType.Procedure || sym.symbolType === SymbolType.Function)) {
      procSym = sym;
      break;
    }
    current = current.parent;
  }

  if (!procSym) return null;

  // 3. Get the parameters for this procedure/function
  const params = getParameterSymbols(table, procSym);
  if (params.length === 0) return null;

  // 4. Build signature label and parameter information
  const paramLabels: string[] = [];
  const paramInfos: ParameterInformation[] = [];
  let labelOffset = procSym.name.length + 1; // after "name("

  for (const p of params) {
    const parts: string[] = [p.name];
    if (p.parameterMode) parts.push(p.parameterMode);
    if (p.dataType) parts.push(p.dataType);
    const paramText = parts.join(" ");
    paramLabels.push(paramText);
    paramInfos.push({
      label: [labelOffset, labelOffset + paramText.length],
    });
    labelOffset += paramText.length + 2; // ", "
  }

  const label = `${procSym.name}(${paramLabels.join(", ")})`;

  const sigInfo: SignatureInformation = {
    label,
    parameters: paramInfos,
  };

  return {
    signatures: [sigInfo],
    activeSignature: 0,
    activeParameter: Math.min(ctx.activeParameter, params.length - 1),
  };
}
