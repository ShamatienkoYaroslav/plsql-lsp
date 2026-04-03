import { SyntaxNode, isToken } from "./parser/ast.js";
import { TokenType } from "./parser/tokens.js";
import {
  TypeHierarchyItem,
  SymbolKind,
} from "vscode-languageserver/node";

// ─── Helpers ───────────────────────────────────────────────────────────────

function isIdentChar(ch: number): boolean {
  return (
    (ch >= 65 && ch <= 90) ||
    (ch >= 97 && ch <= 122) ||
    (ch >= 48 && ch <= 57) ||
    ch === 95 || ch === 36 || ch === 35
  );
}

// ─── Type Info ─────────────────────────────────────────────────────────────

interface TypeInfo {
  name: string;
  normalizedName: string;
  parentName?: string; // normalized parent type name from UNDER clause
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  selectionRange: { start: { line: number; character: number }; end: { line: number; character: number } };
}

/** Extract the last identifier text from a QualifiedName node. */
function getQualifiedNameText(node: SyntaxNode): string | undefined {
  const tokens = node.children.filter(c => isToken(c) && c.type !== TokenType.Dot);
  if (tokens.length === 0) return undefined;
  const last = tokens[tokens.length - 1];
  return isToken(last) ? last.text : undefined;
}

/** Collect all CREATE TYPE declarations with their inheritance info. */
function collectTypes(ast: SyntaxNode): TypeInfo[] {
  const types: TypeInfo[] = [];
  walkForTypes(ast, types);
  return types;
}

function walkForTypes(node: SyntaxNode, types: TypeInfo[]): void {
  if (node.kind === "CreateType") {
    const info = extractTypeInfo(node);
    if (info) types.push(info);
    return;
  }
  for (const child of node.children) {
    if (!isToken(child)) {
      walkForTypes(child, types);
    }
  }
}

function extractTypeInfo(node: SyntaxNode): TypeInfo | undefined {
  // Find the type name (QualifiedName after TYPE keyword)
  let nameText: string | undefined;
  let nameStart: { line: number; col: number } | undefined;
  let nameEnd: { line: number; col: number } | undefined;
  let parentName: string | undefined;

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];

    // Look for QualifiedName after TYPE keyword
    if (!isToken(child) && child.kind === "QualifiedName" && !nameText) {
      nameText = getQualifiedNameText(child);
      if (nameText) {
        // Find the last identifier token in QualifiedName for selectionRange
        const identTokens = child.children.filter(c => isToken(c) && c.type !== TokenType.Dot);
        const lastToken = identTokens[identTokens.length - 1];
        if (isToken(lastToken)) {
          nameStart = { line: lastToken.line, col: lastToken.col };
          nameEnd = { line: lastToken.line, col: lastToken.col + lastToken.text.length };
        }
      }
    }

    // Look for UNDER keyword followed by QualifiedName
    if (isToken(child) && child.type === TokenType.UNDER) {
      const next = node.children[i + 1];
      if (next && !isToken(next) && next.kind === "QualifiedName") {
        parentName = getQualifiedNameText(next)?.toUpperCase();
      }
    }
  }

  if (!nameText || !nameStart || !nameEnd) return undefined;

  return {
    name: nameText,
    normalizedName: nameText.toUpperCase(),
    parentName,
    range: {
      start: { line: node.range.start.line, character: node.range.start.col },
      end: { line: node.range.end.line, character: node.range.end.col },
    },
    selectionRange: {
      start: { line: nameStart.line, character: nameStart.col },
      end: { line: nameEnd.line, character: nameEnd.col },
    },
  };
}

function typeInfoToItem(info: TypeInfo, uri: string): TypeHierarchyItem {
  return {
    name: info.name,
    kind: SymbolKind.Class,
    uri,
    range: info.range,
    selectionRange: info.selectionRange,
  };
}

// ─── Prepare ───────────────────────────────────────────────────────────────

export function prepareTypeHierarchy(
  ast: SyntaxNode,
  text: string,
  offset: number,
  uri: string,
): TypeHierarchyItem[] | null {
  let wordStart = offset;
  while (wordStart > 0 && isIdentChar(text.charCodeAt(wordStart - 1))) wordStart--;
  let wordEnd = offset;
  while (wordEnd < text.length && isIdentChar(text.charCodeAt(wordEnd))) wordEnd++;
  const word = text.slice(wordStart, wordEnd);
  if (word.length === 0) return null;

  const types = collectTypes(ast);
  const normalized = word.toUpperCase();
  const match = types.find(t => t.normalizedName === normalized);
  if (!match) return null;

  return [typeInfoToItem(match, uri)];
}

// ─── Supertypes ────────────────────────────────────────────────────────────

export function getSupertypes(
  item: TypeHierarchyItem,
  ast: SyntaxNode,
  _text: string,
  uri: string,
): TypeHierarchyItem[] {
  const types = collectTypes(ast);
  const normalized = item.name.toUpperCase();
  const match = types.find(t => t.normalizedName === normalized);
  if (!match || !match.parentName) return [];

  const parent = types.find(t => t.normalizedName === match.parentName);
  if (!parent) return [];

  return [typeInfoToItem(parent, uri)];
}

// ─── Subtypes ──────────────────────────────────────────────────────────────

export function getSubtypes(
  item: TypeHierarchyItem,
  ast: SyntaxNode,
  _text: string,
  uri: string,
): TypeHierarchyItem[] {
  const types = collectTypes(ast);
  const normalized = item.name.toUpperCase();

  return types
    .filter(t => t.parentName === normalized)
    .map(t => typeInfoToItem(t, uri));
}
