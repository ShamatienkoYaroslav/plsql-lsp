import { SyntaxNode, Range, Position, isToken } from "./parser/ast.js";
import { Token, TokenType } from "./parser/tokens.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export enum SymbolType {
  Variable = "variable",
  Constant = "constant",
  Parameter = "parameter",
  Cursor = "cursor",
  Exception = "exception",
  Procedure = "procedure",
  Function = "function",
  Type = "type",
  Subtype = "subtype",
  RecordField = "record_field",
  Label = "label",
  ForLoopVariable = "for_loop_variable",
}

export interface SymbolInfo {
  name: string;
  normalizedName: string;
  symbolType: SymbolType;
  dataType?: string;
  parameterMode?: string;
  range: Range;
  nameRange: Range;
  scope: Scope;
}

export interface Scope {
  name: string;
  kind: string;
  range: Range;
  parent: Scope | null;
  children: Scope[];
  symbols: Map<string, SymbolInfo>;
}

export interface SymbolTable {
  globalScope: Scope;
  allSymbols: SymbolInfo[];
  allScopes: Scope[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Normalize an identifier for case-insensitive lookup.
 *  Quoted identifiers (e.g. "Foo") preserve case; regular identifiers are uppercased. */
function normalizeIdentifier(token: Token): { name: string; normalizedName: string } {
  if (token.type === TokenType.QuotedIdentifier) {
    // Strip surrounding double quotes
    const stripped = token.text.slice(1, -1);
    return { name: token.text, normalizedName: stripped };
  }
  return { name: token.text, normalizedName: token.text.toUpperCase() };
}

/** Build a Range for a single token. */
function tokenRange(token: Token): Range {
  return {
    start: { offset: token.offset, line: token.line, col: token.col },
    end: { offset: token.offset + token.text.length, line: token.line, col: token.col + token.text.length },
  };
}

/** Create a new scope. */
function createScope(name: string, kind: string, range: Range, parent: Scope | null): Scope {
  const scope: Scope = { name, kind, range, parent, children: [], symbols: new Map() };
  if (parent) {
    parent.children.push(scope);
  }
  return scope;
}

/** Add a symbol to a scope (and to the flat allSymbols list). */
function addSymbol(
  allSymbols: SymbolInfo[],
  scope: Scope,
  token: Token,
  symbolType: SymbolType,
  declRange: Range,
  dataType?: string,
  parameterMode?: string,
): SymbolInfo {
  const { name, normalizedName } = normalizeIdentifier(token);
  const info: SymbolInfo = {
    name,
    normalizedName,
    symbolType,
    dataType,
    parameterMode,
    range: declRange,
    nameRange: tokenRange(token),
    scope,
  };
  scope.symbols.set(normalizedName, info);
  allSymbols.push(info);
  return info;
}

/** Extract the text representation of a DataType AST node by concatenating its token texts. */
function extractDataTypeText(node: SyntaxNode): string {
  const parts: string[] = [];
  for (const child of node.children) {
    if (isToken(child)) {
      parts.push(child.text);
    } else {
      // Recurse into sub-nodes (e.g., Parenthesized inside DataType)
      parts.push(extractDataTypeText(child));
    }
  }
  return parts.join(" ");
}

/** Find a DataType node among children starting from a given index. */
function findDataTypeNode(children: (SyntaxNode | Token)[], startIndex: number): SyntaxNode | undefined {
  for (let i = startIndex; i < children.length; i++) {
    const child = children[i];
    if (!isToken(child) && child.kind === "DataType") {
      return child;
    }
  }
  return undefined;
}

/** Get the name from a QualifiedName node (last identifier, or full dotted text). */
function getQualifiedNameText(node: SyntaxNode): { token: Token; fullName: string } | undefined {
  const tokens: Token[] = [];
  for (const child of node.children) {
    if (isToken(child)) {
      tokens.push(child);
    }
  }
  // Find the last non-dot token (keywords can be used as identifiers in Oracle)
  const identTokens = tokens.filter(t => t.type !== TokenType.Dot);
  if (identTokens.length === 0) return undefined;
  const lastToken = identTokens[identTokens.length - 1];
  const fullName = tokens.map(t => t.text).join("");
  return { token: lastToken, fullName };
}

/** Find the name token/node after a specific keyword in a node's children.
 *  Returns the identifier token (from QualifiedName or bare identifier). */
function findNameAfterKeyword(node: SyntaxNode, keyword: string): Token | undefined {
  const upper = keyword.toUpperCase();
  for (let i = 0; i < node.children.length - 1; i++) {
    const child = node.children[i];
    if (isToken(child) && child.text.toUpperCase() === upper) {
      const next = node.children[i + 1];
      if (!isToken(next) && next.kind === "QualifiedName") {
        const info = getQualifiedNameText(next);
        return info?.token;
      }
      // Accept any token as identifier (Oracle allows keywords as identifiers)
      if (isToken(next) && next.type !== TokenType.EOF && next.type !== TokenType.Semicolon &&
          next.type !== TokenType.LeftParen && next.type !== TokenType.RightParen) {
        return next;
      }
    }
  }
  return undefined;
}

// ─── Scope-creating node kinds ─────────────────────────────────────────────

const SCOPE_CREATING_KINDS = new Set([
  "Script",
  "AnonymousBlock",
  "ProcedureBody",
  "ProcedureDecl",
  "FunctionBody",
  "FunctionDecl",
  "PackageSpec",
  "PackageBody",
  "TriggerBody",
  "TypeBody",
  "Block",
  "ForRangeLoop",
  "CursorForLoop",
]);

// ─── Main: buildSymbolTable ────────────────────────────────────────────────

export function buildSymbolTable(ast: SyntaxNode): SymbolTable {
  const allSymbols: SymbolInfo[] = [];
  const allScopes: Scope[] = [];

  const globalScope = createScope("<global>", "Script", ast.range, null);
  allScopes.push(globalScope);

  walkNode(ast, globalScope, allSymbols, allScopes);

  return { globalScope, allSymbols, allScopes };
}

function walkNode(
  node: SyntaxNode,
  currentScope: Scope,
  allSymbols: SymbolInfo[],
  allScopes: Scope[],
): void {
  for (const child of node.children) {
    if (isToken(child)) continue;
    processNode(child, currentScope, allSymbols, allScopes);
  }
}

function processNode(
  node: SyntaxNode,
  parentScope: Scope,
  allSymbols: SymbolInfo[],
  allScopes: Scope[],
): void {
  switch (node.kind) {
    case "ProcedureBody":
      processProcedureOrFunction(node, parentScope, allSymbols, allScopes, SymbolType.Procedure, "PROCEDURE");
      return;
    case "FunctionBody":
      processProcedureOrFunction(node, parentScope, allSymbols, allScopes, SymbolType.Function, "FUNCTION");
      return;
    case "ProcedureDecl":
      processProcedureDecl(node, parentScope, allSymbols, allScopes);
      return;
    case "FunctionDecl":
      processFunctionDecl(node, parentScope, allSymbols, allScopes);
      return;
    case "PackageSpec":
      processPackageOrBody(node, parentScope, allSymbols, allScopes, "PackageSpec");
      return;
    case "PackageBody":
      processPackageOrBody(node, parentScope, allSymbols, allScopes, "PackageBody");
      return;
    case "TriggerBody":
      processTriggerBody(node, parentScope, allSymbols, allScopes);
      return;
    case "TypeBody":
      processTypeBody(node, parentScope, allSymbols, allScopes);
      return;
    case "AnonymousBlock":
      processAnonymousBlock(node, parentScope, allSymbols, allScopes);
      return;
    case "Block":
      processBlock(node, parentScope, allSymbols, allScopes);
      return;
    case "ForRangeLoop":
    case "CursorForLoop":
      processForLoop(node, parentScope, allSymbols, allScopes);
      return;
    case "VariableDecl":
      processVariableDecl(node, parentScope, allSymbols);
      return;
    case "ExceptionDecl":
      processExceptionDecl(node, parentScope, allSymbols);
      return;
    case "CursorDecl":
      processCursorDecl(node, parentScope, allSymbols);
      return;
    case "TypeDecl":
      processTypeDecl(node, parentScope, allSymbols);
      return;
    case "SubtypeDecl":
      processSubtypeDecl(node, parentScope, allSymbols);
      return;
    case "Label":
      processLabel(node, parentScope, allSymbols);
      return;
    default:
      // Recurse into non-scope-creating, non-declaration nodes
      walkNode(node, parentScope, allSymbols, allScopes);
      return;
  }
}

// ─── Procedure / Function (Body) ───────────────────────────────────────────

function processProcedureOrFunction(
  node: SyntaxNode,
  parentScope: Scope,
  allSymbols: SymbolInfo[],
  allScopes: Scope[],
  symType: SymbolType,
  keyword: string,
): void {
  const nameToken = findNameAfterKeyword(node, keyword);
  const scopeName = nameToken ? nameToken.text : `<anonymous ${keyword.toLowerCase()}>`;

  // Register the procedure/function name as a symbol in the parent scope
  if (nameToken) {
    addSymbol(allSymbols, parentScope, nameToken, symType, node.range);
  }

  // Create a new scope for the body
  const bodyScope = createScope(scopeName, node.kind, node.range, parentScope);
  allScopes.push(bodyScope);

  // Extract parameters
  extractParameters(node, bodyScope, allSymbols);

  // Walk children (Declarations, Block, etc.) in the new scope
  walkNode(node, bodyScope, allSymbols, allScopes);
}

// ─── ProcedureDecl (may or may not have a body) ────────────────────────────

function processProcedureDecl(
  node: SyntaxNode,
  parentScope: Scope,
  allSymbols: SymbolInfo[],
  allScopes: Scope[],
): void {
  const nameToken = findNameAfterKeyword(node, "PROCEDURE");

  // Register in parent scope
  if (nameToken) {
    addSymbol(allSymbols, parentScope, nameToken, SymbolType.Procedure, node.range);
  }

  // Check if this decl has a body (IS/AS keyword present followed by Declarations + Block)
  const hasBody = node.children.some(
    c => isToken(c) && (c.type === TokenType.IS || c.type === TokenType.AS),
  );

  if (hasBody) {
    const scopeName = nameToken ? nameToken.text : "<anonymous procedure>";
    const bodyScope = createScope(scopeName, node.kind, node.range, parentScope);
    allScopes.push(bodyScope);
    extractParameters(node, bodyScope, allSymbols);
    walkNode(node, bodyScope, allSymbols, allScopes);
  } else {
    // Forward declaration only — still extract parameters into a scope for completeness
    // but don't create a child scope since there's no body
  }
}

// ─── FunctionDecl (may or may not have a body) ────────────────────────────

function processFunctionDecl(
  node: SyntaxNode,
  parentScope: Scope,
  allSymbols: SymbolInfo[],
  allScopes: Scope[],
): void {
  const nameToken = findNameAfterKeyword(node, "FUNCTION");

  if (nameToken) {
    addSymbol(allSymbols, parentScope, nameToken, SymbolType.Function, node.range);
  }

  const hasBody = node.children.some(
    c => isToken(c) && (c.type === TokenType.IS || c.type === TokenType.AS),
  );

  if (hasBody) {
    const scopeName = nameToken ? nameToken.text : "<anonymous function>";
    const bodyScope = createScope(scopeName, node.kind, node.range, parentScope);
    allScopes.push(bodyScope);
    extractParameters(node, bodyScope, allSymbols);
    walkNode(node, bodyScope, allSymbols, allScopes);
  }
}

// ─── Package Spec / Body ───────────────────────────────────────────────────

function processPackageOrBody(
  node: SyntaxNode,
  parentScope: Scope,
  allSymbols: SymbolInfo[],
  allScopes: Scope[],
  kind: string,
): void {
  // Find the package name: after PACKAGE for spec, after BODY for body
  let nameToken: Token | undefined;
  if (kind === "PackageBody") {
    nameToken = findNameAfterKeyword(node, "BODY");
  }
  if (!nameToken) {
    nameToken = findNameAfterKeyword(node, "PACKAGE");
  }

  const scopeName = nameToken ? nameToken.text : "<anonymous package>";

  const pkgScope = createScope(scopeName, node.kind, node.range, parentScope);
  allScopes.push(pkgScope);

  walkNode(node, pkgScope, allSymbols, allScopes);
}

// ─── Trigger Body ──────────────────────────────────────────────────────────

function processTriggerBody(
  node: SyntaxNode,
  parentScope: Scope,
  allSymbols: SymbolInfo[],
  allScopes: Scope[],
): void {
  const nameToken = findNameAfterKeyword(node, "TRIGGER");
  const scopeName = nameToken ? nameToken.text : "<anonymous trigger>";

  const triggerScope = createScope(scopeName, node.kind, node.range, parentScope);
  allScopes.push(triggerScope);

  walkNode(node, triggerScope, allSymbols, allScopes);
}

// ─── Type Body ─────────────────────────────────────────────────────────────

function processTypeBody(
  node: SyntaxNode,
  parentScope: Scope,
  allSymbols: SymbolInfo[],
  allScopes: Scope[],
): void {
  const nameToken = findNameAfterKeyword(node, "BODY") ?? findNameAfterKeyword(node, "TYPE");
  const scopeName = nameToken ? nameToken.text : "<anonymous type>";

  const typeScope = createScope(scopeName, node.kind, node.range, parentScope);
  allScopes.push(typeScope);

  walkNode(node, typeScope, allSymbols, allScopes);
}

// ─── Anonymous Block ───────────────────────────────────────────────────────

function processAnonymousBlock(
  node: SyntaxNode,
  parentScope: Scope,
  allSymbols: SymbolInfo[],
  allScopes: Scope[],
): void {
  const blockScope = createScope("<anonymous>", node.kind, node.range, parentScope);
  allScopes.push(blockScope);

  walkNode(node, blockScope, allSymbols, allScopes);
}

// ─── Block (BEGIN...END) ───────────────────────────────────────────────────

function processBlock(
  node: SyntaxNode,
  parentScope: Scope,
  allSymbols: SymbolInfo[],
  allScopes: Scope[],
): void {
  // A Block node (BEGIN...END) does not create a new scope on its own —
  // it's the container (ProcedureBody, AnonymousBlock, etc.) that creates the scope.
  // Just walk its children in the current scope.
  walkNode(node, parentScope, allSymbols, allScopes);
}

// ─── FOR Loops ─────────────────────────────────────────────────────────────

function processForLoop(
  node: SyntaxNode,
  parentScope: Scope,
  allSymbols: SymbolInfo[],
  allScopes: Scope[],
): void {
  // Create a scope for the loop variable
  const loopScope = createScope("<for_loop>", node.kind, node.range, parentScope);
  allScopes.push(loopScope);

  // The loop variable is the second child (index 1) — a token after FOR
  if (node.children.length > 1) {
    const varChild = node.children[1];
    if (isToken(varChild) && (varChild.type === TokenType.Identifier || varChild.type === TokenType.QuotedIdentifier)) {
      addSymbol(allSymbols, loopScope, varChild, SymbolType.ForLoopVariable, node.range);
    }
  }

  // Walk remaining children in the loop scope
  walkNode(node, loopScope, allSymbols, allScopes);
}

// ─── Variable Declaration ──────────────────────────────────────────────────

function processVariableDecl(
  node: SyntaxNode,
  scope: Scope,
  allSymbols: SymbolInfo[],
): void {
  // First child is the name token
  if (node.children.length === 0) return;
  const nameChild = node.children[0];
  if (!isToken(nameChild)) return;

  // Check for CONSTANT keyword
  let isConst = false;
  for (const child of node.children) {
    if (isToken(child) && child.type === TokenType.CONSTANT) {
      isConst = true;
      break;
    }
  }

  // Find data type
  const dtNode = findDataTypeNode(node.children, 1);
  const dataType = dtNode ? extractDataTypeText(dtNode) : undefined;

  addSymbol(
    allSymbols,
    scope,
    nameChild,
    isConst ? SymbolType.Constant : SymbolType.Variable,
    node.range,
    dataType,
  );
}

// ─── Exception Declaration ─────────────────────────────────────────────────

function processExceptionDecl(
  node: SyntaxNode,
  scope: Scope,
  allSymbols: SymbolInfo[],
): void {
  // First child is the name token
  if (node.children.length === 0) return;
  const nameChild = node.children[0];
  if (!isToken(nameChild)) return;

  addSymbol(allSymbols, scope, nameChild, SymbolType.Exception, node.range);
}

// ─── Cursor Declaration ────────────────────────────────────────────────────

function processCursorDecl(
  node: SyntaxNode,
  scope: Scope,
  allSymbols: SymbolInfo[],
): void {
  // Children: [CURSOR token, name token, ...]
  if (node.children.length < 2) return;
  const nameChild = node.children[1];
  if (!isToken(nameChild)) return;

  addSymbol(allSymbols, scope, nameChild, SymbolType.Cursor, node.range);
}

// ─── Type Declaration ──────────────────────────────────────────────────────

function processTypeDecl(
  node: SyntaxNode,
  scope: Scope,
  allSymbols: SymbolInfo[],
): void {
  // Children: [TYPE token, name token, IS token, ...]
  if (node.children.length < 2) return;
  const nameChild = node.children[1];
  if (!isToken(nameChild)) return;

  addSymbol(allSymbols, scope, nameChild, SymbolType.Type, node.range);
}

// ─── Subtype Declaration ───────────────────────────────────────────────────

function processSubtypeDecl(
  node: SyntaxNode,
  scope: Scope,
  allSymbols: SymbolInfo[],
): void {
  // Children: [SUBTYPE token, name token, IS token, DataType]
  if (node.children.length < 2) return;
  const nameChild = node.children[1];
  if (!isToken(nameChild)) return;

  const dtNode = findDataTypeNode(node.children, 3);
  const dataType = dtNode ? extractDataTypeText(dtNode) : undefined;

  addSymbol(allSymbols, scope, nameChild, SymbolType.Subtype, node.range, dataType);
}

// ─── Label ─────────────────────────────────────────────────────────────────

function processLabel(
  node: SyntaxNode,
  scope: Scope,
  allSymbols: SymbolInfo[],
): void {
  // Children: [<, <, identifier, >, >]
  // Find the identifier token
  for (const child of node.children) {
    if (isToken(child) && (child.type === TokenType.Identifier || child.type === TokenType.QuotedIdentifier)) {
      addSymbol(allSymbols, scope, child, SymbolType.Label, node.range);
      return;
    }
  }
}

// ─── Parameter extraction ──────────────────────────────────────────────────

function extractParameters(
  node: SyntaxNode,
  scope: Scope,
  allSymbols: SymbolInfo[],
): void {
  for (const child of node.children) {
    if (isToken(child)) continue;
    if (child.kind === "Parenthesized") {
      // Look for Parameter nodes inside the Parenthesized node
      for (const paramChild of child.children) {
        if (!isToken(paramChild) && paramChild.kind === "Parameter") {
          processParameter(paramChild, scope, allSymbols);
        }
      }
    }
  }
}

function processParameter(
  node: SyntaxNode,
  scope: Scope,
  allSymbols: SymbolInfo[],
): void {
  // Children: [name token, optional IN/OUT tokens, optional NOCOPY, DataType, optional default]
  if (node.children.length === 0) return;
  const nameChild = node.children[0];
  if (!isToken(nameChild)) return;

  // Determine parameter mode
  let mode: string | undefined;
  let hasIn = false;
  let hasOut = false;
  for (const child of node.children) {
    if (isToken(child)) {
      if (child.type === TokenType.IN) hasIn = true;
      if (child.type === TokenType.OUT) hasOut = true;
    }
  }
  if (hasIn && hasOut) {
    mode = "IN OUT";
  } else if (hasOut) {
    mode = "OUT";
  } else if (hasIn) {
    mode = "IN";
  }
  // If no mode tokens, Oracle defaults to IN, but we leave it undefined here

  // Find data type
  const dtNode = findDataTypeNode(node.children, 1);
  const dataType = dtNode ? extractDataTypeText(dtNode) : undefined;

  addSymbol(allSymbols, scope, nameChild, SymbolType.Parameter, node.range, dataType, mode);
}

// ─── Lookup functions ──────────────────────────────────────────────────────

/** Find the innermost scope that contains the given position. */
export function findScopeAtPosition(table: SymbolTable, position: Position): Scope {
  let best: Scope = table.globalScope;

  function search(scope: Scope): void {
    if (containsPosition(scope.range, position)) {
      best = scope;
      for (const child of scope.children) {
        search(child);
      }
    }
  }

  search(table.globalScope);
  return best;
}

/** Resolve a symbol name at a given position by walking up the scope chain. */
export function resolveSymbol(
  table: SymbolTable,
  name: string,
  position: Position,
): SymbolInfo | undefined {
  const scope = findScopeAtPosition(table, position);
  const normalized = name.toUpperCase();
  return lookupInScopeChain(scope, normalized);
}

function lookupInScopeChain(scope: Scope, normalizedName: string): SymbolInfo | undefined {
  let current: Scope | null = scope;
  while (current !== null) {
    const sym = current.symbols.get(normalizedName);
    if (sym) return sym;
    current = current.parent;
  }
  return undefined;
}

/** Check if a range contains a position. */
function containsPosition(range: Range, position: Position): boolean {
  // Use offset-based comparison when offsets are available
  if (position.offset !== undefined && range.start.offset !== undefined && range.end.offset !== undefined) {
    return position.offset >= range.start.offset && position.offset <= range.end.offset;
  }

  // Line/col comparison
  if (position.line < range.start.line || position.line > range.end.line) {
    return false;
  }
  if (position.line === range.start.line && position.col < range.start.col) {
    return false;
  }
  if (position.line === range.end.line && position.col > range.end.col) {
    return false;
  }
  return true;
}
