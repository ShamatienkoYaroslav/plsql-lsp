import {
  Diagnostic,
  DiagnosticSeverity,
} from "vscode-languageserver/node";
import { SyntaxNode, isToken } from "./parser/ast.js";
import { Token, TokenType } from "./parser/tokens.js";
import type { CatalogProvider } from "./catalogProvider.js";

export function getCatalogDiagnostics(
  ast: SyntaxNode,
  text: string,
  catalog?: CatalogProvider,
  tableSeverity?: DiagnosticSeverity | null,
  columnSeverity?: DiagnosticSeverity | null,
): Diagnostic[] {
  if (!catalog?.isConnected) return [];

  const effectiveTableSev = tableSeverity === undefined ? DiagnosticSeverity.Warning : tableSeverity;
  const effectiveColumnSev = columnSeverity === undefined ? DiagnosticSeverity.Warning : columnSeverity;

  // If both are disabled, nothing to do
  if (effectiveTableSev === null && effectiveColumnSev === null) return [];

  const diagnostics: Diagnostic[] = [];
  // alias (upper) -> tableName (upper)
  const tableAliases = new Map<string, string>();

  // Pass 1: collect all TableRef nodes to build the alias map before checking columns.
  // This is necessary because DotAccess nodes in the SELECT list appear in the AST
  // before the TableRef nodes in the FROM clause during a depth-first walk.
  collectTableAliases(ast, tableAliases);

  // Pass 2: validate tables and columns now that all aliases are known.
  validateNode(ast, catalog, diagnostics, text, tableAliases, effectiveTableSev, effectiveColumnSev);

  return diagnostics;
}

// ─── Pass 1: collect aliases ──────────────────────────────────────────────────

function collectTableAliases(
  node: SyntaxNode,
  tableAliases: Map<string, string>,
): void {
  if (node.kind === "TableRef") {
    extractAlias(node, tableAliases);
  }
  for (const child of node.children) {
    if (!isToken(child)) {
      collectTableAliases(child, tableAliases);
    }
  }
}

function extractAlias(
  node: SyntaxNode,
  tableAliases: Map<string, string>,
): void {
  const qualName = node.children.find(
    (c) => !isToken(c) && (c as SyntaxNode).kind === "QualifiedName",
  ) as SyntaxNode | undefined;
  if (!qualName) return;

  const nameTokens = qualName.children.filter(isToken) as Token[];
  if (nameTokens.length === 0) return;

  const tableNameToken = nameTokens[nameTokens.length - 1];
  const tableName = tableNameToken.text.toUpperCase();

  // Register the table name itself so direct qualified column refs work (EMPLOYEES.col)
  tableAliases.set(tableName, tableName);

  // Look for alias after the QualifiedName — bare token or inside an Alias child node
  const qualNameIdx = node.children.indexOf(qualName);
  for (let i = qualNameIdx + 1; i < node.children.length; i++) {
    const child = node.children[i];
    if (isToken(child) && isIdentifierLike(child)) {
      tableAliases.set(child.text.toUpperCase(), tableName);
      break;
    }
    if (!isToken(child) && (child as SyntaxNode).kind === "Alias") {
      // The parser wraps aliases in an Alias node
      const aliasNode = child as SyntaxNode;
      const aliasTok = aliasNode.children.find(isToken) as Token | undefined;
      if (aliasTok && isIdentifierLike(aliasTok)) {
        tableAliases.set(aliasTok.text.toUpperCase(), tableName);
      }
      break;
    }
  }
}

// ─── Pass 2: validate tables and columns ──────────────────────────────────────

function validateNode(
  node: SyntaxNode,
  catalog: CatalogProvider,
  diagnostics: Diagnostic[],
  text: string,
  tableAliases: Map<string, string>,
  tableSeverity: DiagnosticSeverity | null,
  columnSeverity: DiagnosticSeverity | null,
): void {
  if (node.kind === "TableRef" && tableSeverity !== null) {
    processTableRef(node, catalog, diagnostics, text, tableSeverity);
  } else if (node.kind === "DotAccess" && columnSeverity !== null) {
    processDotAccess(node, catalog, diagnostics, text, tableAliases, columnSeverity);
  }

  for (const child of node.children) {
    if (!isToken(child)) {
      validateNode(child, catalog, diagnostics, text, tableAliases, tableSeverity, columnSeverity);
    }
  }
}

function processTableRef(
  node: SyntaxNode,
  catalog: CatalogProvider,
  diagnostics: Diagnostic[],
  text: string,
  severity: DiagnosticSeverity,
): void {
  const qualName = node.children.find(
    (c) => !isToken(c) && (c as SyntaxNode).kind === "QualifiedName",
  ) as SyntaxNode | undefined;
  if (!qualName) return;

  const nameTokens = qualName.children.filter(isToken) as Token[];
  if (nameTokens.length === 0) return;

  const tableNameToken = nameTokens[nameTokens.length - 1];
  const tableName = tableNameToken.text.toUpperCase();

  if (!catalog.getTable(tableName)) {
    const startPos = offsetToLineChar(text, tableNameToken.offset);
    const endPos = offsetToLineChar(
      text,
      tableNameToken.offset + tableNameToken.text.length,
    );
    diagnostics.push({
      severity,
      range: { start: startPos, end: endPos },
      message: `Table '${tableNameToken.text}' does not exist`,
      source: "plsql-lsp(catalog)",
    });
  }
}

function processDotAccess(
  node: SyntaxNode,
  catalog: CatalogProvider,
  diagnostics: Diagnostic[],
  text: string,
  tableAliases: Map<string, string>,
  severity: DiagnosticSeverity,
): void {
  // DotAccess children: Identifier node (qualifier), Dot token, Identifier token (column)
  // For two-dot chains (schema.table.column), the first child is a nested DotAccess
  // instead of an Identifier.
  const children = node.children;

  // Extract the qualifier text from the first child
  let qualifierText = "";
  const identNode = children.find(
    (c) => !isToken(c) && (c as SyntaxNode).kind === "Identifier",
  ) as SyntaxNode | undefined;
  if (identNode) {
    const tok = identNode.children.find(isToken) as Token | undefined;
    if (tok) qualifierText = tok.text;
  }

  // Handle nested DotAccess (schema.qualifier. pattern)
  // Extract the member (second identifier) from the inner DotAccess as the effective qualifier
  if (!qualifierText) {
    const innerDot = children.find(
      (c) => !isToken(c) && (c as SyntaxNode).kind === "DotAccess",
    ) as SyntaxNode | undefined;
    if (innerDot) {
      // The inner DotAccess's member token (after the dot) is our effective qualifier
      let foundInnerDot = false;
      for (const child of innerDot.children) {
        if (isToken(child)) {
          if (child.type === TokenType.Dot) {
            foundInnerDot = true;
          } else if (foundInnerDot && isIdentifierLike(child)) {
            qualifierText = child.text;
            break;
          }
        }
      }
    }
  }
  if (!qualifierText) return;

  // Find the column name token (identifier after the dot)
  let columnToken: Token | undefined;
  let foundDot = false;
  for (const child of children) {
    if (isToken(child)) {
      if (child.type === TokenType.Dot) {
        foundDot = true;
      } else if (foundDot && isIdentifierLike(child)) {
        columnToken = child;
        break;
      }
    }
  }
  if (!columnToken) return;

  // Resolve qualifier to a table name
  const upperQualifier = qualifierText.toUpperCase();
  const resolvedTable = tableAliases.get(upperQualifier) ?? upperQualifier;

  // Only flag columns of known tables (unknown tables are already flagged)
  const table = catalog.getTable(resolvedTable);
  if (!table) return;

  // Check if column exists
  const colName = columnToken.text.toUpperCase();
  const columnExists = table.columns.some((c) => c.columnName === colName);
  if (!columnExists) {
    const startPos = offsetToLineChar(text, columnToken.offset);
    const endPos = offsetToLineChar(
      text,
      columnToken.offset + columnToken.text.length,
    );
    diagnostics.push({
      severity,
      range: { start: startPos, end: endPos },
      message: `Column '${columnToken.text}' does not exist in table '${resolvedTable}'`,
      source: "plsql-lsp(catalog)",
    });
  }
}

/**
 * Check whether a token can act as an identifier.
 * The lexer produces TokenType.Identifier for regular identifiers, but many
 * Oracle keywords are context-sensitive and can appear as column/table names.
 * We treat a token as identifier-like if it is an Identifier or QuotedIdentifier,
 * or if it is an alphabetic keyword token (not a symbol/operator).
 */
function isIdentifierLike(token: Token): boolean {
  if (
    token.type === TokenType.Identifier ||
    token.type === TokenType.QuotedIdentifier
  ) {
    return true;
  }
  // Exclude operators, literals, and punctuation
  const nonIdTypes = new Set<TokenType>([
    TokenType.EOF,
    TokenType.Error,
    TokenType.Whitespace,
    TokenType.SingleLineComment,
    TokenType.MultiLineComment,
    TokenType.RemarkComment,
    TokenType.StringLiteral,
    TokenType.NationalStringLiteral,
    TokenType.QStringLiteral,
    TokenType.IntegerLiteral,
    TokenType.NumberLiteral,
    TokenType.HexStringLiteral,
    TokenType.BindVariable,
    TokenType.InquiryDirective,
    TokenType.PromptMessage,
    TokenType.StartCommand,
    TokenType.LeftParen,
    TokenType.RightParen,
    TokenType.LeftBracket,
    TokenType.RightBracket,
    TokenType.LeftCurly,
    TokenType.RightCurly,
    TokenType.Comma,
    TokenType.Dot,
    TokenType.DoubleDot,
    TokenType.Semicolon,
    TokenType.Colon,
    TokenType.DoubleAsterisk,
    TokenType.Asterisk,
    TokenType.Plus,
    TokenType.Minus,
    TokenType.Slash,
    TokenType.Equals,
    TokenType.NotEquals,
    TokenType.LessThan,
    TokenType.GreaterThan,
    TokenType.LessThanEquals,
    TokenType.GreaterThanEquals,
    TokenType.Assign,
  ]);
  // If it's not in the exclusion set and has alphabetic text, treat it as identifier-like
  if (nonIdTypes.has(token.type)) return false;
  return /^[a-zA-Z_][a-zA-Z0-9_$#]*$/.test(token.text);
}

function offsetToLineChar(
  text: string,
  offset: number,
): { line: number; character: number } {
  let line = 0;
  let lastNewline = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      lastNewline = i;
    }
  }
  return { line, character: offset - lastNewline - 1 };
}
