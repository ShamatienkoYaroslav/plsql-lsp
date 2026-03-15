import { DocumentSymbol, SymbolKind } from "vscode-languageserver/node";
import { SyntaxNode, isToken } from "./parser/ast.js";
import { Token, TokenType } from "./parser/tokens.js";

/**
 * Extract document symbols from a parsed AST for the textDocument/documentSymbol request.
 */
export function getDocumentSymbols(ast: SyntaxNode): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];
  collectSymbols(ast, symbols);
  return symbols;
}

/** Node kinds that should not be recursed into for symbol discovery.
 *  These represent DML statements and DDL internals (columns, constraints, etc.)
 *  where we don't expect meaningful document symbols. */
const SKIP_NODES = new Set([
  // DML statements
  "SelectStatement", "InsertStatement", "UpdateStatement", "DeleteStatement",
  "MergeStatement", "LockTableStatement", "ExplainPlanStatement",
  // DML internals
  "QueryBlock", "SelectList", "SelectItem", "IntoClause", "TableRefList",
  "TableRef", "JoinClause", "WhereClause", "GroupByClause", "OrderByClause",
  "HierarchicalClause", "ForUpdateClause", "WithClause", "CommonTableExpression",
  "SetOperation", "ParenSubquery", "PivotClause", "ModelClause",
  "OffsetFetchClause", "FetchClause", "ReturningClause",
  "InsertIntoClause", "MultiTableInsert", "MergeWhenClause", "SetItem",
  // DDL internals
  "ColumnDef", "ViewColumn", "IndexColumn", "OutOfLineConstraint", "TypeMember",
  "DataType",
]);

function collectSymbols(node: SyntaxNode, symbols: DocumentSymbol[]): void {
  for (const child of node.children) {
    if (isToken(child)) continue;
    if (SKIP_NODES.has(child.kind)) continue;
    const sym = nodeToSymbol(child);
    if (sym) {
      symbols.push(sym);
    } else {
      // Recurse into non-symbol nodes (e.g., Declarations, Block, Script)
      collectSymbols(child, symbols);
    }
  }
}

function nodeToSymbol(node: SyntaxNode): DocumentSymbol | null {
  switch (node.kind) {
    case "ProcedureBody":
      return makeSymbol(node, findNameTokenAfterKeyword(node, "PROCEDURE"), SymbolKind.Function);
    case "FunctionBody":
      return makeSymbol(node, findNameTokenAfterKeyword(node, "FUNCTION"), SymbolKind.Function);
    case "PackageSpec":
      return makeSymbol(node, findNameTokenAfterKeyword(node, "PACKAGE"), SymbolKind.Package);
    case "PackageBody":
      return makeSymbol(node, findNameTokenAfterKeyword(node, "BODY"), SymbolKind.Package);
    case "TriggerBody":
      return makeSymbol(node, findNameTokenAfterKeyword(node, "TRIGGER"), SymbolKind.Event);
    case "TypeBody":
      return makeSymbol(node, findNameTokenAfterKeyword(node, "BODY") ?? findNameTokenAfterKeyword(node, "TYPE"), SymbolKind.Class);
    case "CreateTable":
      return makeSymbol(node, findQualifiedNameNode(node), SymbolKind.Struct);
    case "CreateView":
      return makeSymbol(node, findQualifiedNameNode(node), SymbolKind.Struct);
    case "CreateIndex":
      return makeSymbol(node, findQualifiedNameNode(node), SymbolKind.Key);
    case "CreateSequence":
      return makeSymbol(node, findQualifiedNameNode(node), SymbolKind.Constant);
    case "CreateType":
      return makeSymbol(node, findQualifiedNameNode(node), SymbolKind.Class);
    case "CreateSynonym":
      return makeSymbol(node, findQualifiedNameNode(node), SymbolKind.Variable);
    case "ProcedureDecl":
      return makeSymbol(node, findNameTokenAfterKeyword(node, "PROCEDURE"), SymbolKind.Function);
    case "FunctionDecl":
      return makeSymbol(node, findNameTokenAfterKeyword(node, "FUNCTION"), SymbolKind.Function);
    case "CursorDecl":
      return makeSymbol(node, getChildToken(node, 1), SymbolKind.Interface);
    case "TypeDecl":
      return makeSymbol(node, getChildToken(node, 1), SymbolKind.Class);
    case "SubtypeDecl":
      return makeSymbol(node, getChildToken(node, 1), SymbolKind.Class);
    case "VariableDecl":
      return makeSymbol(node, getChildToken(node, 0), isConstant(node) ? SymbolKind.Field : SymbolKind.Field);
    case "ExceptionDecl":
      return makeSymbol(node, getChildToken(node, 0), SymbolKind.Event);
    case "AnonymousBlock":
      return makeAnonymousBlockSymbol(node);
    default:
      return null;
  }
}

interface NameInfo {
  name: string;
  range: { start: { line: number; col: number }; end: { line: number; col: number } };
}

function makeSymbol(
  node: SyntaxNode,
  nameInfo: NameInfo | null,
  kind: SymbolKind,
): DocumentSymbol | null {
  if (!nameInfo) return null;
  const range = toLspRange(node.range);
  const selectionRange = toLspRange(nameInfo.range);
  const children: DocumentSymbol[] = [];
  collectSymbols(node, children);
  return { name: nameInfo.name, kind, range, selectionRange, children: children.length > 0 ? children : undefined };
}

function makeAnonymousBlockSymbol(node: SyntaxNode): DocumentSymbol | null {
  const range = toLspRange(node.range);
  const children: DocumentSymbol[] = [];
  collectSymbols(node, children);
  if (children.length === 0) return null;
  return { name: "<anonymous block>", kind: SymbolKind.Namespace, range, selectionRange: range, children };
}

/** Find the first QualifiedName node and return its name + range. */
function findQualifiedNameNode(node: SyntaxNode): NameInfo | null {
  for (const child of node.children) {
    if (!isToken(child) && child.kind === "QualifiedName") {
      return { name: qualifiedNameText(child), range: child.range };
    }
  }
  return null;
}

/** Find first QualifiedName or identifier after a keyword token. */
function findNameTokenAfterKeyword(node: SyntaxNode, keyword: string): NameInfo | null {
  const upper = keyword.toUpperCase();
  for (let i = 0; i < node.children.length - 1; i++) {
    const child = node.children[i];
    if (isToken(child) && child.text.toUpperCase() === upper) {
      const next = node.children[i + 1];
      if (!isToken(next) && next.kind === "QualifiedName") {
        return { name: qualifiedNameText(next), range: next.range };
      }
      if (isToken(next) && (next.type === TokenType.Identifier || next.type === TokenType.QuotedIdentifier)) {
        return {
          name: next.text,
          range: { start: { line: next.line, col: next.col }, end: { line: next.line, col: next.col + next.text.length } },
        };
      }
    }
  }
  return null;
}

/** Get a token at a given children index and return its name + range. */
function getChildToken(node: SyntaxNode, index: number): NameInfo | null {
  if (index >= node.children.length) return null;
  const child = node.children[index];
  if (isToken(child)) {
    return {
      name: child.text,
      range: { start: { line: child.line, col: child.col }, end: { line: child.line, col: child.col + child.text.length } },
    };
  }
  if (child.kind === "QualifiedName") {
    return { name: qualifiedNameText(child), range: child.range };
  }
  return null;
}

/** Check if a VariableDecl has a CONSTANT keyword. */
function isConstant(node: SyntaxNode): boolean {
  for (const child of node.children) {
    if (isToken(child) && child.text.toUpperCase() === "CONSTANT") return true;
  }
  return false;
}

/** Combine dotted name tokens: schema.name -> "schema.name" */
function qualifiedNameText(node: SyntaxNode): string {
  return node.children
    .filter((c): c is Token => isToken(c))
    .map(t => t.text)
    .join(".");
}

function toLspRange(range: { start: { line: number; col: number }; end: { line: number; col: number } }) {
  return {
    start: { line: range.start.line, character: range.start.col },
    end: { line: range.end.line, character: range.end.col },
  };
}
