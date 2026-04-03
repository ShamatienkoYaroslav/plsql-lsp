import { SyntaxNode, Range as AstRange } from "./parser/ast.js";
import {
  buildSymbolTable,
  findScopeAtPosition,
  resolveReferences,
  Scope,
  SymbolInfo,
  SymbolType,
} from "./symbolTable.js";
import {
  CallHierarchyItem,
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
  SymbolKind,
} from "vscode-languageserver/node";

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

// ─── Range / Item helpers ────────────────────────────────────────────────

function toLspRange(range: AstRange): { start: { line: number; character: number }; end: { line: number; character: number } } {
  return {
    start: { line: range.start.line, character: range.start.col },
    end: { line: range.end.line, character: range.end.col },
  };
}

function symbolToItem(sym: SymbolInfo, uri: string): CallHierarchyItem {
  return {
    name: sym.name,
    kind: sym.symbolType === SymbolType.Function ? SymbolKind.Function : SymbolKind.Method,
    uri,
    range: toLspRange(sym.range),
    selectionRange: toLspRange(sym.nameRange),
  };
}

/** Check whether a scope (or one of its ancestors) is a Procedure or Function scope. */
function findEnclosingCallableScope(scope: Scope): Scope | null {
  let current: Scope | null = scope;
  while (current) {
    if (
      current.kind === "ProcedureBody" ||
      current.kind === "ProcedureDecl" ||
      current.kind === "FunctionBody" ||
      current.kind === "FunctionDecl"
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/** Find a SymbolInfo for a procedure/function whose scope matches the given scope. */
function findSymbolForScope(allSymbols: SymbolInfo[], scope: Scope): SymbolInfo | undefined {
  return allSymbols.find(
    s =>
      (s.symbolType === SymbolType.Procedure || s.symbolType === SymbolType.Function) &&
      s.name.toUpperCase() === scope.name.toUpperCase() &&
      s.range.start.offset === scope.range.start.offset,
  );
}

// ─── prepareCallHierarchy ────────────────────────────────────────────────

export function prepareCallHierarchy(
  ast: SyntaxNode,
  text: string,
  offset: number,
  uri: string,
): CallHierarchyItem[] | null {
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

  // 2. Build symbol table and resolve the identifier
  const table = buildSymbolTable(ast);
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

  // 3. Only return for Procedure or Function symbols
  if (sym.symbolType !== SymbolType.Procedure && sym.symbolType !== SymbolType.Function) {
    return null;
  }

  return [symbolToItem(sym, uri)];
}

// ─── getIncomingCalls ────────────────────────────────────────────────────

export function getIncomingCalls(
  item: CallHierarchyItem,
  ast: SyntaxNode,
  text: string,
): CallHierarchyIncomingCall[] {
  const table = buildSymbolTable(ast);
  const refResult = resolveReferences(ast, table);

  // Find the target symbol by matching name and type
  const normalizedName = item.name.toUpperCase();
  const targetSym = table.allSymbols.find(
    s =>
      (s.symbolType === SymbolType.Procedure || s.symbolType === SymbolType.Function) &&
      s.normalizedName === normalizedName,
  );
  if (!targetSym) return [];

  // Get all references to that symbol
  const refs = refResult.symbolReferences.get(targetSym);
  if (!refs || refs.length === 0) return [];

  // Group references by enclosing callable scope
  const callerMap = new Map<Scope, AstRange[]>();
  for (const ref of refs) {
    const refPosition = { offset: ref.token.offset, line: ref.token.line, col: ref.token.col };
    const refScope = findScopeAtPosition(table, refPosition);
    const callableScope = findEnclosingCallableScope(refScope);
    if (!callableScope) continue;

    // Don't include self-references from the target's own scope
    if (callableScope.range.start.offset === targetSym.range.start.offset) continue;

    let ranges = callerMap.get(callableScope);
    if (!ranges) {
      ranges = [];
      callerMap.set(callableScope, ranges);
    }
    ranges.push(ref.range);
  }

  // Build result
  const uri = item.uri;
  const results: CallHierarchyIncomingCall[] = [];
  for (const [scope, ranges] of callerMap) {
    const callerSym = findSymbolForScope(table.allSymbols, scope);
    if (!callerSym) continue;

    results.push({
      from: symbolToItem(callerSym, uri),
      fromRanges: ranges.map(toLspRange),
    });
  }

  return results;
}

// ─── getOutgoingCalls ────────────────────────────────────────────────────

export function getOutgoingCalls(
  item: CallHierarchyItem,
  ast: SyntaxNode,
  text: string,
): CallHierarchyOutgoingCall[] {
  const table = buildSymbolTable(ast);
  const refResult = resolveReferences(ast, table);

  // Find the source symbol by matching name and type
  const normalizedName = item.name.toUpperCase();
  const sourceSym = table.allSymbols.find(
    s =>
      (s.symbolType === SymbolType.Procedure || s.symbolType === SymbolType.Function) &&
      s.normalizedName === normalizedName,
  );
  if (!sourceSym) return [];

  // Find the scope that corresponds to this symbol's body
  const sourceScope = table.allScopes.find(
    s =>
      (s.kind === "ProcedureBody" || s.kind === "ProcedureDecl" ||
       s.kind === "FunctionBody" || s.kind === "FunctionDecl") &&
      s.range.start.offset === sourceSym.range.start.offset,
  );
  if (!sourceScope) return [];

  // Find all references within the source scope that resolve to Procedure/Function symbols
  const calleeMap = new Map<SymbolInfo, AstRange[]>();
  for (const ref of refResult.references) {
    const resolved = ref.resolvedSymbol;
    if (resolved.symbolType !== SymbolType.Procedure && resolved.symbolType !== SymbolType.Function) {
      continue;
    }

    // Check if this reference is within the source scope
    const refOffset = ref.token.offset;
    if (refOffset < sourceScope.range.start.offset || refOffset > sourceScope.range.end.offset) {
      continue;
    }

    // Don't include self-references
    if (resolved === sourceSym) continue;

    let ranges = calleeMap.get(resolved);
    if (!ranges) {
      ranges = [];
      calleeMap.set(resolved, ranges);
    }
    ranges.push(ref.range);
  }

  // Build result
  const uri = item.uri;
  const results: CallHierarchyOutgoingCall[] = [];
  for (const [calleeSym, ranges] of calleeMap) {
    results.push({
      to: symbolToItem(calleeSym, uri),
      fromRanges: ranges.map(toLspRange),
    });
  }

  return results;
}
