import { Token, TokenType } from "./tokens.js";
import { SyntaxNode, ErrorNode, Range, makeNode, makeErrorNode } from "./ast.js";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";
import { parseExpression, parseExpressionList } from "./expressions.js";
import { parseSelect, parseInsert, parseUpdate, parseDelete, parseMerge, parseLockTable, parseExplainPlan } from "./dml.js";
import { parseCreate, parseAlter, parseDrop } from "./ddl.js";
import { parseAnonymousBlock, parseProcedureBody, parseFunctionBody, parsePackageSpec, parsePackageBody, parseTriggerBody, parseTypeBody } from "./plsql.js";
import { parseGrant, parseRevoke, parseComment, parseAnalyze, parseTransactionControl, parseMiscStatement } from "./misc.js";

export class Parser {
  public tokens: Token[];
  public pos: number;
  public diagnostics: Diagnostic[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
    this.diagnostics = [];
  }

  // --- Token navigation ---

  peek(offset = 0): Token {
    const idx = this.pos + offset;
    if (idx >= this.tokens.length) return this.tokens[this.tokens.length - 1]; // EOF
    return this.tokens[idx];
  }

  advance(): Token {
    const tok = this.tokens[this.pos];
    if (tok.type !== TokenType.EOF) this.pos++;
    return tok;
  }

  check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  checkKeyword(...types: TokenType[]): boolean {
    const t = this.peek().type;
    return types.includes(t);
  }

  match(type: TokenType): Token | null {
    if (this.peek().type === type) return this.advance();
    return null;
  }

  matchKeyword(...types: TokenType[]): Token | null {
    if (types.includes(this.peek().type)) return this.advance();
    return null;
  }

  expect(type: TokenType): Token {
    if (this.peek().type === type) return this.advance();
    const tok = this.peek();
    this.addDiagnostic(tok, `Expected ${type} but found '${tok.text || tok.type}'`);
    // Return a synthetic token without advancing
    return { type, text: "", offset: tok.offset, line: tok.line, col: tok.col };
  }

  isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  // --- Diagnostics ---

  addDiagnostic(token: Token, message: string, severity: DiagnosticSeverity = DiagnosticSeverity.Error): void {
    const endCol = token.col + Math.max(token.text.length, 1);
    this.diagnostics.push({
      severity,
      range: {
        start: { line: token.line, character: token.col },
        end: { line: token.line, character: endCol },
      },
      message,
      source: "plsql",
    });
  }

  // --- Error recovery ---

  synchronize(): void {
    let depth = 0;
    while (!this.isAtEnd()) {
      const t = this.peek().type;
      if (t === TokenType.Semicolon && depth === 0) {
        this.advance();
        return;
      }
      if (t === TokenType.BEGIN) {
        depth++;
        this.advance();
        continue;
      }
      if (t === TokenType.END) {
        if (depth > 0) {
          depth--;
          this.advance();
          continue;
        }
        return;
      }
      if (depth === 0 && (t === TokenType.DECLARE ||
          t === TokenType.CREATE || t === TokenType.ALTER || t === TokenType.DROP ||
          t === TokenType.SELECT || t === TokenType.INSERT || t === TokenType.UPDATE ||
          t === TokenType.DELETE || t === TokenType.GRANT || t === TokenType.REVOKE)) {
        return;
      }
      this.advance();
    }
  }

  // --- Node construction helpers ---

  makeRange(start: Token, end?: Token): Range {
    const e = end ?? this.peek();
    return {
      start: { offset: start.offset, line: start.line, col: start.col },
      end: { offset: e.offset + (e.text?.length ?? 0), line: e.line, col: e.col + (e.text?.length ?? 0) },
    };
  }

  // --- Utility: parse comma-separated list ---

  parseCommaSeparated(parseItem: () => SyntaxNode | Token): (SyntaxNode | Token)[] {
    const items: (SyntaxNode | Token)[] = [];
    items.push(parseItem());
    while (this.match(TokenType.Comma)) {
      items.push(parseItem());
    }
    return items;
  }

  // --- Utility: parse a parenthesized list ---

  parseParenthesized(parseInner: () => (SyntaxNode | Token)[]): SyntaxNode {
    const lp = this.expect(TokenType.LeftParen);
    const children: (SyntaxNode | Token)[] = [lp];
    children.push(...parseInner());
    children.push(this.expect(TokenType.RightParen));
    return makeNode("Parenthesized", children, this.makeRange(lp));
  }

  // --- Utility: consume tokens until we see one of the given types ---

  skipUntil(...types: TokenType[]): Token[] {
    const skipped: Token[] = [];
    while (!this.isAtEnd() && !types.includes(this.peek().type)) {
      skipped.push(this.advance());
    }
    return skipped;
  }

  // --- Identifier parsing (regular or quoted, or unreserved keyword used as identifier) ---

  parseIdentifier(): Token {
    const tok = this.peek();
    if (tok.type === TokenType.Identifier || tok.type === TokenType.QuotedIdentifier) {
      return this.advance();
    }
    // Many keywords can be used as identifiers in Oracle
    // Accept any keyword token as an identifier (Oracle is very permissive)
    if (typeof tok.type === "string" && tok.type !== TokenType.EOF && tok.type !== TokenType.Error &&
        tok.type !== TokenType.Semicolon && tok.type !== TokenType.LeftParen && tok.type !== TokenType.RightParen &&
        tok.type !== TokenType.HintComment) {
      // It's a keyword being used as an identifier
      return this.advance();
    }
    return this.expect(TokenType.Identifier);
  }

  // --- Qualified name: schema.name or name ---

  parseQualifiedName(): SyntaxNode {
    const first = this.parseIdentifier();
    const children: (SyntaxNode | Token)[] = [first];
    while (this.match(TokenType.Dot)) {
      children.push(this.parseIdentifier());
    }
    return makeNode("QualifiedName", children, this.makeRange(first));
  }

  // --- Data type parsing ---

  parseDataType(): SyntaxNode {
    const start = this.peek();
    const children: (SyntaxNode | Token)[] = [];

    // Handle common data types, including dotted names (schema.table.column)
    children.push(this.advance());

    // Dot-separated qualifiers: table.column, schema.table.column
    while (this.check(TokenType.Dot)) {
      children.push(this.advance()); // .
      children.push(this.advance()); // next identifier
    }

    // Type arguments: (precision, scale) or (size CHAR/BYTE)
    if (this.check(TokenType.LeftParen)) {
      children.push(this.parseParenthesized(() => {
        const inner: (SyntaxNode | Token)[] = [];
        while (!this.isAtEnd() && !this.check(TokenType.RightParen)) {
          inner.push(this.advance());
        }
        return inner;
      }));
    }

    // %TYPE or %ROWTYPE
    if (this.check(TokenType.Percent)) {
      children.push(this.advance()); // %
      children.push(this.advance()); // TYPE or ROWTYPE
    }

    return makeNode("DataType", children, this.makeRange(start));
  }

  // --- Main entry point ---

  parseScript(): SyntaxNode {
    const start = this.peek();
    const statements: (SyntaxNode | Token)[] = [];

    while (!this.isAtEnd()) {
      // Skip bare semicolons and slashes (statement terminators)
      if (this.check(TokenType.Semicolon)) {
        statements.push(this.advance());
        continue;
      }
      if (this.check(TokenType.Slash) && this.isStatementBoundary()) {
        statements.push(this.advance());
        continue;
      }

      try {
        const stmt = this.parseStatement();
        if (stmt) statements.push(stmt);
      } catch {
        const errTok = this.peek();
        this.addDiagnostic(errTok, `Unexpected token '${errTok.text || errTok.type}'`);
        this.synchronize();
      }
    }

    return makeNode("Script", statements, this.makeRange(start));
  }

  private isStatementBoundary(): boolean {
    // A standalone / on its own line is a statement terminator in SQL*Plus
    // For simplicity, treat any / that's followed by newline or EOF as a terminator
    return true;
  }

  parseStatement(): SyntaxNode | null {
    const tok = this.peek();
    const type = tok.type;

    switch (type) {
      case TokenType.SELECT:
      case TokenType.WITH:
        return parseSelect(this);

      case TokenType.INSERT:
        return parseInsert(this);

      case TokenType.UPDATE:
        return parseUpdate(this);

      case TokenType.DELETE:
        return parseDelete(this);

      case TokenType.MERGE:
        return parseMerge(this);

      case TokenType.CREATE:
        return parseCreate(this);

      case TokenType.ALTER:
        return parseAlter(this);

      case TokenType.DROP:
        return parseDrop(this);

      case TokenType.BEGIN:
      case TokenType.DECLARE:
        return parseAnonymousBlock(this);

      case TokenType.GRANT:
        return parseGrant(this);

      case TokenType.REVOKE:
        return parseRevoke(this);

      case TokenType.COMMIT:
      case TokenType.ROLLBACK:
      case TokenType.SAVEPOINT:
      case TokenType.SET:
        return parseTransactionControl(this);

      case TokenType.COMMENT:
        return parseComment(this);

      case TokenType.ANALYZE:
        return parseAnalyze(this);

      case TokenType.LOCK:
        return parseLockTable(this);

      case TokenType.EXPLAIN:
        return parseExplainPlan(this);

      case TokenType.TRUNCATE:
      case TokenType.RENAME:
      case TokenType.PURGE:
      case TokenType.FLASHBACK:
      case TokenType.AUDIT:
      case TokenType.NOAUDIT:
      case TokenType.ASSOCIATE:
      case TokenType.DISASSOCIATE:
      case TokenType.CALL:
      case TokenType.EXECUTE:
        return parseMiscStatement(this);

      case TokenType.PROCEDURE:
        return parseProcedureBody(this, [this.advance()]);

      case TokenType.FUNCTION:
        return parseFunctionBody(this, [this.advance()]);

      case TokenType.PACKAGE: {
        const pkg = this.advance();
        if (this.check(TokenType.BODY)) {
          return parsePackageBody(this, [pkg, this.advance()]);
        }
        return parsePackageSpec(this, [pkg]);
      }

      case TokenType.TRIGGER:
        return parseTriggerBody(this, [this.advance()]);

      case TokenType.TYPE: {
        const typ = this.advance();
        if (this.check(TokenType.BODY)) {
          return parseTypeBody(this, [typ, this.advance()]);
        }
        // bare TYPE declaration — fall through to unknown
        return this.parseUnknownStatementWith([typ]);
      }

      case TokenType.PromptMessage:
      case TokenType.StartCommand:
        // SQL*Plus commands — just consume
        return makeNode("SqlPlusCommand", [this.advance()], this.makeRange(tok));

      default:
        // Try as expression statement (e.g., function call in PL/SQL)
        // or unknown statement — consume until semicolon
        return this.parseUnknownStatement();
    }
  }

  private parseUnknownStatement(): SyntaxNode {
    const start = this.peek();
    const children: (SyntaxNode | Token)[] = [];
    // Consume tokens until we hit a statement terminator
    while (!this.isAtEnd() && !this.check(TokenType.Semicolon)) {
      // Stop at keywords that start new statements
      const t = this.peek().type;
      if (this.pos > 0 && (t === TokenType.CREATE || t === TokenType.ALTER || t === TokenType.DROP ||
          t === TokenType.SELECT || t === TokenType.INSERT || t === TokenType.UPDATE ||
          t === TokenType.DELETE || t === TokenType.BEGIN || t === TokenType.DECLARE ||
          t === TokenType.GRANT || t === TokenType.REVOKE)) {
        break;
      }
      children.push(this.advance());
    }

    if (children.length === 0 && !this.isAtEnd()) {
      // Single unexpected token
      const errTok = this.advance();
      this.addDiagnostic(errTok, `Unexpected token '${errTok.text}'`);
      return makeErrorNode(`Unexpected token '${errTok.text}'`, [errTok], this.makeRange(start));
    }

    return makeNode("UnknownStatement", children, this.makeRange(start));
  }

  parseUnknownStatementWith(initial: Token[]): SyntaxNode {
    const start = initial[0];
    const children: (SyntaxNode | Token)[] = [...initial];
    while (!this.isAtEnd() && !this.check(TokenType.Semicolon)) {
      const t = this.peek().type;
      if (t === TokenType.CREATE || t === TokenType.ALTER || t === TokenType.DROP ||
          t === TokenType.SELECT || t === TokenType.INSERT || t === TokenType.UPDATE ||
          t === TokenType.DELETE || t === TokenType.BEGIN || t === TokenType.DECLARE ||
          t === TokenType.GRANT || t === TokenType.REVOKE) {
        break;
      }
      children.push(this.advance());
    }
    return makeNode("UnknownStatement", children, this.makeRange(start));
  }
}
