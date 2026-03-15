import { Token, TokenType } from "./tokens.js";
import { SyntaxNode, makeNode } from "./ast.js";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { Parser } from "./parser.js";
import { parseExpression, parseExpressionList } from "./expressions.js";
import { parseSelect } from "./dml.js";

// ─── Anonymous Block ───────────────────────────────────────────────────────

export function parseAnonymousBlock(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];

  // Optional DECLARE section
  if (p.match(TokenType.DECLARE)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseDeclarations(p));
  }

  // BEGIN ... END
  children.push(parseBlock(p));

  return makeNode("AnonymousBlock", children, p.makeRange(start));
}

// ─── Block: BEGIN ... END [name] ───────────────────────────────────────────

function parseBlock(p: Parser): SyntaxNode {
  const start = p.expect(TokenType.BEGIN);
  const children: (SyntaxNode | Token)[] = [start];

  children.push(parseStatementList(p));

  // EXCEPTION handler
  if (p.check(TokenType.EXCEPTION)) {
    children.push(parseExceptionSection(p));
  }

  if (p.isAtEnd()) {
    p.addDiagnostic(start, "Unclosed BEGIN block \u2014 expected END");
  }
  children.push(p.expect(TokenType.END));

  // Optional name after END
  if (p.check(TokenType.Identifier) || p.check(TokenType.QuotedIdentifier)) {
    children.push(p.advance());
  }

  return makeNode("Block", children, p.makeRange(start));
}

// ─── Statement List ────────────────────────────────────────────────────────

function parseStatementList(p: Parser): SyntaxNode {
  const start = p.peek();
  const stmts: (SyntaxNode | Token)[] = [];

  while (!p.isAtEnd() && !p.check(TokenType.END) && !p.check(TokenType.EXCEPTION) &&
         !p.check(TokenType.WHEN) && !p.check(TokenType.ELSIF) && !p.check(TokenType.ELSE)) {
    // Skip bare semicolons
    if (p.match(TokenType.Semicolon)) continue;

    try {
      const stmt = parsePlSqlStatement(p);
      if (stmt) stmts.push(stmt);

      // Consume trailing semicolons
      if (p.check(TokenType.Semicolon)) {
        stmts.push(p.advance());
      } else if (!p.isAtEnd() && !p.check(TokenType.END) && !p.check(TokenType.EXCEPTION) &&
                 !p.check(TokenType.WHEN) && !p.check(TokenType.ELSIF) && !p.check(TokenType.ELSE)) {
        // Next token looks like the start of a new statement — warn about missing semicolon
        const next = p.peek().type;
        if (next === TokenType.IF || next === TokenType.LOOP || next === TokenType.FOR ||
            next === TokenType.WHILE || next === TokenType.NULL_ || next === TokenType.RETURN ||
            next === TokenType.EXIT || next === TokenType.CONTINUE || next === TokenType.GOTO ||
            next === TokenType.RAISE || next === TokenType.BEGIN || next === TokenType.DECLARE ||
            next === TokenType.OPEN || next === TokenType.FETCH || next === TokenType.CLOSE ||
            next === TokenType.EXECUTE || next === TokenType.PIPE || next === TokenType.FORALL ||
            next === TokenType.SELECT || next === TokenType.INSERT || next === TokenType.UPDATE ||
            next === TokenType.DELETE || next === TokenType.MERGE || next === TokenType.COMMIT ||
            next === TokenType.ROLLBACK || next === TokenType.SAVEPOINT || next === TokenType.CASE ||
            next === TokenType.PRAGMA) {
          // Use the previous token position for the diagnostic
          const prevTok = p.pos > 0 ? p.tokens[p.pos - 1] : p.peek();
          p.addDiagnostic(prevTok, "Missing semicolon after statement", DiagnosticSeverity.Warning);
        }
      }
    } catch {
      const errTok = p.peek();
      p.addDiagnostic(errTok, `Unexpected token '${errTok.text || errTok.type}'`);
      p.synchronize();
    }
  }

  return makeNode("StatementList", stmts, p.makeRange(start));
}

// ─── PL/SQL Statement ─────────────────────────────────────────────────────

function parsePlSqlStatement(p: Parser): SyntaxNode | null {
  const tok = p.peek();

  // Labels: <<label_name>>
  if (tok.type === TokenType.LessThan && p.peek(1).type === TokenType.LessThan) {
    return parseLabel(p);
  }

  switch (tok.type) {
    case TokenType.IF: return parseIf(p);
    case TokenType.CASE: return parseCaseStatement(p);
    case TokenType.LOOP: return parseLoop(p);
    case TokenType.WHILE: return parseWhileLoop(p);
    case TokenType.FOR: return parseForLoop(p);
    case TokenType.FORALL: return parseForall(p);
    case TokenType.OPEN: return parseOpen(p);
    case TokenType.FETCH: return parseFetch(p);
    case TokenType.CLOSE: return parseClose(p);
    case TokenType.RETURN: return parseReturn(p);
    case TokenType.EXIT: return parseExit(p);
    case TokenType.CONTINUE: return parseContinue(p);
    case TokenType.GOTO: return parseGoto(p);
    case TokenType.RAISE: return parseRaise(p);
    case TokenType.NULL_: return parseNull(p);
    case TokenType.PIPE: return parsePipeRow(p);
    case TokenType.EXECUTE: return parseExecuteImmediate(p);
    case TokenType.BEGIN:
    case TokenType.DECLARE:
      return parseAnonymousBlock(p);
    case TokenType.PRAGMA: return parsePragma(p);
    case TokenType.DOLLAR_IF:
    case TokenType.DOLLAR_ERROR:
      return parseConditionalCompilation(p);

    // DML statements
    case TokenType.SELECT:
    case TokenType.WITH:
    case TokenType.INSERT:
    case TokenType.UPDATE:
    case TokenType.DELETE:
    case TokenType.MERGE:
    case TokenType.COMMIT:
    case TokenType.ROLLBACK:
    case TokenType.SAVEPOINT:
    case TokenType.SET:
    case TokenType.LOCK:
      return p.parseStatement();

    default:
      // Assignment or procedure call: name := expr or name(args)
      return parseAssignmentOrCall(p);
  }
}

// ─── Declarations ──────────────────────────────────────────────────────────

function parseDeclarations(p: Parser): SyntaxNode {
  const start = p.peek();
  const decls: (SyntaxNode | Token)[] = [];

  while (!p.isAtEnd() && !p.check(TokenType.BEGIN) && !p.check(TokenType.END)) {
    // Skip bare semicolons
    if (p.match(TokenType.Semicolon)) continue;

    try {
      const decl = parseDeclaration(p);
      if (decl) decls.push(decl);
      if (p.check(TokenType.Semicolon)) decls.push(p.advance());
    } catch {
      const errTok = p.peek();
      p.addDiagnostic(errTok, `Unexpected token in declaration '${errTok.text || errTok.type}'`);
      p.synchronize();
    }
  }

  return makeNode("Declarations", decls, p.makeRange(start));
}

function parseDeclaration(p: Parser): SyntaxNode | null {
  const tok = p.peek();

  switch (tok.type) {
    case TokenType.CURSOR: return parseCursorDecl(p);
    case TokenType.TYPE: return parseTypeDecl(p);
    case TokenType.SUBTYPE: return parseSubtypeDecl(p);
    case TokenType.PROCEDURE: return parseProcedureDecl(p);
    case TokenType.FUNCTION: return parseFunctionDecl(p);
    case TokenType.PRAGMA: return parsePragma(p);
    case TokenType.EXCEPTION_INIT:
    case TokenType.SERIALLY_REUSABLE:
    case TokenType.AUTONOMOUS_TRANSACTION:
    case TokenType.RESTRICT_REFERENCES:
      // These are pragma names — shouldn't appear here, but handle gracefully
      return parsePragma(p);
    case TokenType.DOLLAR_IF:
    case TokenType.DOLLAR_ERROR:
      return parseConditionalCompilation(p);

    default:
      // Variable/constant declaration: name [CONSTANT] type [:= expr]
      return parseVarDecl(p);
  }
}

function parseVarDecl(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];

  children.push(p.parseIdentifier()); // variable name

  // CONSTANT
  if (p.match(TokenType.CONSTANT)) {
    children.push(p.tokens[p.pos - 1]);
  }

  // EXCEPTION is a special declaration
  if (p.check(TokenType.EXCEPTION)) {
    children.push(p.advance());
    return makeNode("ExceptionDecl", children, p.makeRange(start));
  }

  // Data type
  children.push(p.parseDataType());

  // NOT NULL
  if (p.check(TokenType.NOT) && p.peek(1).type === TokenType.NULL_) {
    children.push(p.advance());
    children.push(p.advance());
  }

  // := or DEFAULT
  if (p.match(TokenType.Assign) || p.match(TokenType.DEFAULT)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseExpression(p));
  }

  return makeNode("VariableDecl", children, p.makeRange(start));
}

function parseCursorDecl(p: Parser): SyntaxNode {
  const start = p.advance(); // CURSOR
  const children: (SyntaxNode | Token)[] = [start];

  children.push(p.parseIdentifier()); // cursor name

  // Optional parameter list
  if (p.check(TokenType.LeftParen)) {
    children.push(p.parseParenthesized(() =>
      p.parseCommaSeparated(() => parseCursorParam(p))
    ));
  }

  // RETURN type
  if (p.match(TokenType.RETURN)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.parseDataType());
  }

  // IS SELECT ...
  if (p.match(TokenType.IS)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseSelect(p));
  }

  return makeNode("CursorDecl", children, p.makeRange(start));
}

function parseCursorParam(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];
  children.push(p.parseIdentifier());
  if (p.match(TokenType.IN)) children.push(p.tokens[p.pos - 1]);
  children.push(p.parseDataType());
  if (p.match(TokenType.Assign) || p.match(TokenType.DEFAULT)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseExpression(p));
  }
  return makeNode("CursorParam", children, p.makeRange(start));
}

function parseTypeDecl(p: Parser): SyntaxNode {
  const start = p.advance(); // TYPE
  const children: (SyntaxNode | Token)[] = [start];

  children.push(p.parseIdentifier()); // type name
  children.push(p.expect(TokenType.IS));

  // TABLE OF / VARRAY / RECORD / REF CURSOR
  if (p.check(TokenType.TABLE)) {
    children.push(p.advance());
    children.push(p.expect(TokenType.OF));
    children.push(p.parseDataType());
    if (p.match(TokenType.INDEX)) {
      children.push(p.tokens[p.pos - 1]);
      children.push(p.expect(TokenType.BY));
      children.push(p.parseDataType());
    }
    if (p.check(TokenType.NOT) && p.peek(1).type === TokenType.NULL_) {
      children.push(p.advance());
      children.push(p.advance());
    }
  } else if (p.checkKeyword(TokenType.VARRAY, TokenType.VARYING)) {
    children.push(p.advance());
    if (p.check(TokenType.LeftParen)) {
      children.push(p.parseParenthesized(() => [parseExpression(p)]));
    }
    children.push(p.expect(TokenType.OF));
    children.push(p.parseDataType());
    if (p.check(TokenType.NOT) && p.peek(1).type === TokenType.NULL_) {
      children.push(p.advance());
      children.push(p.advance());
    }
  } else if (p.check(TokenType.RECORD)) {
    children.push(p.advance());
    children.push(p.parseParenthesized(() =>
      p.parseCommaSeparated(() => parseRecordField(p))
    ));
  } else if (p.check(TokenType.REF)) {
    children.push(p.advance());
    children.push(p.expect(TokenType.CURSOR));
    if (p.match(TokenType.RETURN)) {
      children.push(p.tokens[p.pos - 1]);
      children.push(p.parseDataType());
    }
  } else {
    // Other type definition — consume generically
    children.push(p.parseDataType());
  }

  return makeNode("TypeDecl", children, p.makeRange(start));
}

function parseRecordField(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];
  children.push(p.parseIdentifier());
  children.push(p.parseDataType());
  if (p.check(TokenType.NOT) && p.peek(1).type === TokenType.NULL_) {
    children.push(p.advance());
    children.push(p.advance());
  }
  if (p.match(TokenType.Assign) || p.match(TokenType.DEFAULT)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseExpression(p));
  }
  return makeNode("RecordField", children, p.makeRange(start));
}

function parseSubtypeDecl(p: Parser): SyntaxNode {
  const start = p.advance(); // SUBTYPE
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.parseIdentifier());
  children.push(p.expect(TokenType.IS));
  children.push(p.parseDataType());
  if (p.check(TokenType.NOT) && p.peek(1).type === TokenType.NULL_) {
    children.push(p.advance());
    children.push(p.advance());
  }
  return makeNode("SubtypeDecl", children, p.makeRange(start));
}

function parseProcedureDecl(p: Parser): SyntaxNode {
  const start = p.advance(); // PROCEDURE
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.parseIdentifier());

  if (p.check(TokenType.LeftParen)) {
    children.push(parseParameterList(p));
  }

  // IS/AS ... body (for local procedures in declarations)
  if (p.matchKeyword(TokenType.IS, TokenType.AS)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseDeclarations(p));
    children.push(parseBlock(p));
  }

  return makeNode("ProcedureDecl", children, p.makeRange(start));
}

function parseFunctionDecl(p: Parser): SyntaxNode {
  const start = p.advance(); // FUNCTION
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.parseIdentifier());

  if (p.check(TokenType.LeftParen)) {
    children.push(parseParameterList(p));
  }

  children.push(p.expect(TokenType.RETURN));
  children.push(p.parseDataType());

  // Optional DETERMINISTIC, PIPELINED, PARALLEL_ENABLE, RESULT_CACHE
  while (p.checkKeyword(TokenType.DETERMINISTIC, TokenType.PIPELINED, TokenType.PARALLEL_ENABLE, TokenType.RESULT_CACHE)) {
    children.push(p.advance());
  }

  // IS/AS ... body (for local functions)
  if (p.matchKeyword(TokenType.IS, TokenType.AS)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseDeclarations(p));
    children.push(parseBlock(p));
  }

  return makeNode("FunctionDecl", children, p.makeRange(start));
}

function parseParameterList(p: Parser): SyntaxNode {
  return p.parseParenthesized(() =>
    p.parseCommaSeparated(() => parseParameter(p))
  );
}

function parseParameter(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];

  children.push(p.parseIdentifier()); // parameter name

  // IN, OUT, IN OUT, NOCOPY
  if (p.match(TokenType.IN)) {
    children.push(p.tokens[p.pos - 1]);
    if (p.match(TokenType.OUT)) children.push(p.tokens[p.pos - 1]);
  } else if (p.match(TokenType.OUT)) {
    children.push(p.tokens[p.pos - 1]);
  }
  if (p.match(TokenType.NOCOPY)) children.push(p.tokens[p.pos - 1]);

  // Data type
  children.push(p.parseDataType());

  // Default value
  if (p.match(TokenType.Assign) || p.match(TokenType.DEFAULT)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseExpression(p));
  }

  return makeNode("Parameter", children, p.makeRange(start));
}

function parsePragma(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];

  if (p.check(TokenType.PRAGMA)) {
    children.push(p.advance()); // PRAGMA
  }

  // Consume until semicolon
  while (!p.isAtEnd() && !p.check(TokenType.Semicolon)) {
    children.push(p.advance());
  }

  return makeNode("Pragma", children, p.makeRange(start));
}

// ─── Control Flow Statements ───────────────────────────────────────────────

function parseIf(p: Parser): SyntaxNode {
  const start = p.advance(); // IF
  const children: (SyntaxNode | Token)[] = [start];

  children.push(parseExpression(p));
  children.push(p.expect(TokenType.THEN));
  children.push(parseStatementList(p));

  while (p.match(TokenType.ELSIF)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseExpression(p));
    children.push(p.expect(TokenType.THEN));
    children.push(parseStatementList(p));
  }

  if (p.match(TokenType.ELSE)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseStatementList(p));
  }

  if (p.isAtEnd()) {
    p.addDiagnostic(start, "Unclosed IF statement \u2014 expected END IF");
  }
  children.push(p.expect(TokenType.END));
  children.push(p.expect(TokenType.IF));

  return makeNode("IfStatement", children, p.makeRange(start));
}

function parseCaseStatement(p: Parser): SyntaxNode {
  const start = p.advance(); // CASE
  const children: (SyntaxNode | Token)[] = [start];

  // Simple vs searched CASE
  if (!p.check(TokenType.WHEN)) {
    children.push(parseExpression(p));
  }

  while (p.match(TokenType.WHEN)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseExpression(p));
    children.push(p.expect(TokenType.THEN));
    children.push(parseStatementList(p));
  }

  if (p.match(TokenType.ELSE)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseStatementList(p));
  }

  if (p.isAtEnd()) {
    p.addDiagnostic(start, "Unclosed CASE statement \u2014 expected END CASE");
  }
  children.push(p.expect(TokenType.END));
  if (p.match(TokenType.CASE)) {
    children.push(p.tokens[p.pos - 1]);
  }

  return makeNode("CaseStatement", children, p.makeRange(start));
}

function parseLoop(p: Parser): SyntaxNode {
  const start = p.advance(); // LOOP
  const children: (SyntaxNode | Token)[] = [start];
  children.push(parseStatementList(p));
  if (p.isAtEnd()) {
    p.addDiagnostic(start, "Unclosed LOOP \u2014 expected END LOOP");
  }
  children.push(p.expect(TokenType.END));
  children.push(p.expect(TokenType.LOOP));
  // Optional label
  if (p.check(TokenType.Identifier)) children.push(p.advance());
  return makeNode("LoopStatement", children, p.makeRange(start));
}

function parseWhileLoop(p: Parser): SyntaxNode {
  const start = p.advance(); // WHILE
  const children: (SyntaxNode | Token)[] = [start];
  children.push(parseExpression(p));
  children.push(p.expect(TokenType.LOOP));
  children.push(parseStatementList(p));
  if (p.isAtEnd()) {
    p.addDiagnostic(start, "Unclosed WHILE LOOP \u2014 expected END LOOP");
  }
  children.push(p.expect(TokenType.END));
  children.push(p.expect(TokenType.LOOP));
  if (p.check(TokenType.Identifier)) children.push(p.advance());
  return makeNode("WhileLoopStatement", children, p.makeRange(start));
}

function parseForLoop(p: Parser): SyntaxNode {
  const start = p.advance(); // FOR
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.parseIdentifier()); // loop variable

  children.push(p.expect(TokenType.IN));

  let isCursorFor = false;

  // Could be cursor subquery, range, or cursor name
  if (p.check(TokenType.LeftParen)) {
    // Cursor subquery: FOR rec IN (SELECT ...)
    isCursorFor = true;
    children.push(p.parseParenthesized(() => {
      return [parseSelect(p)];
    }));
  } else if (p.check(TokenType.REVERSE)) {
    // REVERSE range: FOR i IN REVERSE 1..10
    children.push(p.advance());
    children.push(parseExpression(p));
    children.push(p.expect(TokenType.DoubleDot));
    children.push(parseExpression(p));
  } else {
    // Range or cursor name — parse first expression and check for ..
    const expr = parseExpression(p);
    children.push(expr);
    if (p.match(TokenType.DoubleDot)) {
      // Numeric range: FOR i IN 1..10
      children.push(p.tokens[p.pos - 1]);
      children.push(parseExpression(p));
    } else {
      // Cursor name (possibly with parameters): FOR rec IN cursor_name[(args)]
      isCursorFor = true;
      if (p.check(TokenType.LeftParen)) {
        children.push(p.parseParenthesized(() =>
          p.parseCommaSeparated(() => parseExpression(p))
        ));
      }
    }
  }

  children.push(p.expect(TokenType.LOOP));
  children.push(parseStatementList(p));
  if (p.isAtEnd()) {
    p.addDiagnostic(start, "Unclosed FOR LOOP \u2014 expected END LOOP");
  }
  children.push(p.expect(TokenType.END));
  children.push(p.expect(TokenType.LOOP));
  if (p.check(TokenType.Identifier)) children.push(p.advance());

  return makeNode(isCursorFor ? "CursorForLoop" : "ForRangeLoop", children, p.makeRange(start));
}

function parseForall(p: Parser): SyntaxNode {
  const start = p.advance(); // FORALL
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.parseIdentifier());
  children.push(p.expect(TokenType.IN));

  if (p.match(TokenType.VALUES)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.expect(TokenType.OF));
    children.push(parseExpression(p));
  } else if (p.match(TokenType.INDICES)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.expect(TokenType.OF));
    children.push(parseExpression(p));
    if (p.match(TokenType.BETWEEN)) {
      children.push(p.tokens[p.pos - 1]);
      children.push(parseExpression(p));
      children.push(p.expect(TokenType.AND));
      children.push(parseExpression(p));
    }
  } else {
    children.push(parseExpression(p));
    children.push(p.expect(TokenType.DoubleDot));
    children.push(parseExpression(p));
  }

  // Optional SAVE EXCEPTIONS
  if (p.check(TokenType.SAVE) && p.peek(1).type === TokenType.EXCEPTIONS) {
    children.push(p.advance());
    children.push(p.advance());
  }

  // DML statement
  const stmt = p.parseStatement();
  if (stmt) children.push(stmt);

  return makeNode("ForallStatement", children, p.makeRange(start));
}

function parseOpen(p: Parser): SyntaxNode {
  const start = p.advance(); // OPEN
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.parseQualifiedName());

  // OPEN cursor FOR SELECT ...
  if (p.match(TokenType.FOR)) {
    children.push(p.tokens[p.pos - 1]);
    if (p.check(TokenType.SELECT) || p.check(TokenType.WITH)) {
      children.push(parseSelect(p));
    } else {
      // Dynamic SQL
      children.push(parseExpression(p));
      if (p.match(TokenType.USING)) {
        children.push(p.tokens[p.pos - 1]);
        children.push(...p.parseCommaSeparated(() => parseExpression(p)));
      }
    }
  } else if (p.check(TokenType.LeftParen)) {
    // OPEN cursor(args)
    children.push(p.parseParenthesized(() =>
      p.parseCommaSeparated(() => parseExpression(p))
    ));
  }

  return makeNode("OpenStatement", children, p.makeRange(start));
}

function parseFetch(p: Parser): SyntaxNode {
  const start = p.advance(); // FETCH
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.parseQualifiedName());

  // BULK COLLECT
  if (p.match(TokenType.BULK)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.expect(TokenType.COLLECT));
  }

  children.push(p.expect(TokenType.INTO));
  children.push(...p.parseCommaSeparated(() => parseExpression(p)));

  // LIMIT
  if (p.match(TokenType.LIMIT)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseExpression(p));
  }

  return makeNode("FetchStatement", children, p.makeRange(start));
}

function parseClose(p: Parser): SyntaxNode {
  const start = p.advance(); // CLOSE
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.parseQualifiedName());
  return makeNode("CloseStatement", children, p.makeRange(start));
}

function parseReturn(p: Parser): SyntaxNode {
  const start = p.advance(); // RETURN
  const children: (SyntaxNode | Token)[] = [start];
  if (!p.check(TokenType.Semicolon) && !p.check(TokenType.END) && !p.isAtEnd()) {
    children.push(parseExpression(p));
  }
  return makeNode("ReturnStatement", children, p.makeRange(start));
}

function parseExit(p: Parser): SyntaxNode {
  const start = p.advance(); // EXIT
  const children: (SyntaxNode | Token)[] = [start];
  // Optional label
  if (p.check(TokenType.Identifier)) children.push(p.advance());
  // WHEN condition
  if (p.match(TokenType.WHEN)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseExpression(p));
  }
  return makeNode("ExitStatement", children, p.makeRange(start));
}

function parseContinue(p: Parser): SyntaxNode {
  const start = p.advance(); // CONTINUE
  const children: (SyntaxNode | Token)[] = [start];
  if (p.check(TokenType.Identifier)) children.push(p.advance());
  if (p.match(TokenType.WHEN)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseExpression(p));
  }
  return makeNode("ContinueStatement", children, p.makeRange(start));
}

function parseGoto(p: Parser): SyntaxNode {
  const start = p.advance(); // GOTO
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.parseIdentifier());
  return makeNode("GotoStatement", children, p.makeRange(start));
}

function parseRaise(p: Parser): SyntaxNode {
  const start = p.advance(); // RAISE
  const children: (SyntaxNode | Token)[] = [start];
  if (!p.check(TokenType.Semicolon) && !p.isAtEnd()) {
    children.push(p.parseQualifiedName());
  }
  return makeNode("RaiseStatement", children, p.makeRange(start));
}

function parseNull(p: Parser): SyntaxNode {
  const start = p.advance(); // NULL
  return makeNode("NullStatement", [start], p.makeRange(start));
}

function parsePipeRow(p: Parser): SyntaxNode {
  const start = p.advance(); // PIPE
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.expect(TokenType.ROW));
  children.push(p.parseParenthesized(() => [parseExpression(p)]));
  return makeNode("PipeRowStatement", children, p.makeRange(start));
}

function parseExecuteImmediate(p: Parser): SyntaxNode {
  const start = p.advance(); // EXECUTE
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.expect(TokenType.IMMEDIATE));
  children.push(parseExpression(p));

  // INTO clause
  if (p.check(TokenType.INTO) || p.check(TokenType.BULK)) {
    if (p.match(TokenType.BULK)) {
      children.push(p.tokens[p.pos - 1]);
      children.push(p.expect(TokenType.COLLECT));
    }
    children.push(p.expect(TokenType.INTO));
    children.push(...p.parseCommaSeparated(() => parseExpression(p)));
  }

  // USING clause
  if (p.match(TokenType.USING)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(...p.parseCommaSeparated(() => {
      const start = p.peek();
      const parts: (SyntaxNode | Token)[] = [];
      // Optional IN/OUT/IN OUT
      if (p.match(TokenType.IN)) {
        parts.push(p.tokens[p.pos - 1]);
        if (p.match(TokenType.OUT)) parts.push(p.tokens[p.pos - 1]);
      } else if (p.match(TokenType.OUT)) {
        parts.push(p.tokens[p.pos - 1]);
      }
      parts.push(parseExpression(p));
      return makeNode("UsingParam", parts, p.makeRange(start));
    }));
  }

  // RETURNING/RETURN INTO
  if (p.checkKeyword(TokenType.RETURNING, TokenType.RETURN)) {
    children.push(p.advance());
    if (p.match(TokenType.BULK)) {
      children.push(p.tokens[p.pos - 1]);
      children.push(p.expect(TokenType.COLLECT));
    }
    children.push(p.expect(TokenType.INTO));
    children.push(...p.parseCommaSeparated(() => parseExpression(p)));
  }

  return makeNode("ExecuteImmediateStatement", children, p.makeRange(start));
}

function parseLabel(p: Parser): SyntaxNode {
  const start = p.advance(); // <
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.advance()); // <
  children.push(p.parseIdentifier());
  children.push(p.expect(TokenType.GreaterThan));
  children.push(p.expect(TokenType.GreaterThan));
  return makeNode("Label", children, p.makeRange(start));
}

function parseAssignmentOrCall(p: Parser): SyntaxNode {
  const start = p.peek();
  const target = parseExpression(p);

  // Assignment: target := expr
  if (p.match(TokenType.Assign)) {
    const assign = p.tokens[p.pos - 1];
    const value = parseExpression(p);
    return makeNode("AssignmentStatement", [target, assign, value], p.makeRange(start));
  }

  // Otherwise it's an expression statement (procedure call)
  return makeNode("ExpressionStatement", [target], p.makeRange(start));
}

// ─── Conditional Compilation ──────────────────────────────────────────────

function parseConditionalCompilation(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];

  if (p.check(TokenType.DOLLAR_ERROR)) {
    // $ERROR 'message' $END
    children.push(p.advance()); // $ERROR
    // Consume until $END
    while (!p.isAtEnd() && !p.check(TokenType.DOLLAR_END)) {
      children.push(p.advance());
    }
    children.push(p.expect(TokenType.DOLLAR_END));
    return makeNode("ConditionalCompilation", children, p.makeRange(start));
  }

  children.push(p.expect(TokenType.DOLLAR_IF)); // $IF
  children.push(parseExpression(p)); // condition
  children.push(p.expect(TokenType.DOLLAR_THEN)); // $THEN

  // Body — consume tokens until $ELSIF, $ELSE, or $END
  while (!p.isAtEnd() && !p.check(TokenType.DOLLAR_ELSIF) && !p.check(TokenType.DOLLAR_ELSE) && !p.check(TokenType.DOLLAR_END)) {
    if (p.check(TokenType.Semicolon)) {
      children.push(p.advance());
      continue;
    }
    children.push(p.advance());
  }

  // $ELSIF branches
  while (p.check(TokenType.DOLLAR_ELSIF)) {
    children.push(p.advance()); // $ELSIF
    children.push(parseExpression(p)); // condition
    children.push(p.expect(TokenType.DOLLAR_THEN)); // $THEN
    while (!p.isAtEnd() && !p.check(TokenType.DOLLAR_ELSIF) && !p.check(TokenType.DOLLAR_ELSE) && !p.check(TokenType.DOLLAR_END)) {
      if (p.check(TokenType.Semicolon)) {
        children.push(p.advance());
        continue;
      }
      children.push(p.advance());
    }
  }

  // $ELSE branch
  if (p.check(TokenType.DOLLAR_ELSE)) {
    children.push(p.advance()); // $ELSE
    while (!p.isAtEnd() && !p.check(TokenType.DOLLAR_END)) {
      if (p.check(TokenType.Semicolon)) {
        children.push(p.advance());
        continue;
      }
      children.push(p.advance());
    }
  }

  children.push(p.expect(TokenType.DOLLAR_END)); // $END

  return makeNode("ConditionalCompilation", children, p.makeRange(start));
}

// ─── Exception Section ────────────────────────────────────────────────────

function parseExceptionSection(p: Parser): SyntaxNode {
  const start = p.advance(); // EXCEPTION
  const children: (SyntaxNode | Token)[] = [start];

  while (p.match(TokenType.WHEN)) {
    const whenChildren: (SyntaxNode | Token)[] = [p.tokens[p.pos - 1]];

    // Exception name(s): name [OR name ...]
    whenChildren.push(p.parseQualifiedName());
    while (p.match(TokenType.OR)) {
      whenChildren.push(p.tokens[p.pos - 1]);
      whenChildren.push(p.parseQualifiedName());
    }

    whenChildren.push(p.expect(TokenType.THEN));
    whenChildren.push(parseStatementList(p));

    children.push(makeNode("ExceptionHandler", whenChildren, p.makeRange(p.tokens[p.pos - 1])));
  }

  return makeNode("ExceptionSection", children, p.makeRange(start));
}

// ─── Top-level CREATE PROCEDURE / FUNCTION / PACKAGE bodies ────────────────

export function parseProcedureBody(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  const start = children[0] as Token;

  // [schema.]name
  children.push(p.parseQualifiedName());

  // Parameters
  if (p.check(TokenType.LeftParen)) {
    children.push(parseParameterList(p));
  }

  // Optional AUTHID / ACCESSIBLE BY / DEFAULT COLLATION / etc.
  while (p.checkKeyword(TokenType.AUTHID, TokenType.ACCESSIBLE, TokenType.DEFAULT, TokenType.SHARING)) {
    // Consume clause
    while (!p.isAtEnd() && !p.checkKeyword(TokenType.IS, TokenType.AS) && !p.check(TokenType.Semicolon)) {
      children.push(p.advance());
    }
  }

  // IS/AS or ; (for declaration only)
  if (p.matchKeyword(TokenType.IS, TokenType.AS)) {
    children.push(p.tokens[p.pos - 1]);

    // Could be: LANGUAGE JAVA NAME '...'
    // or: EXTERNAL NAME '...'
    // or regular PL/SQL body
    if (p.checkKeyword(TokenType.LANGUAGE, TokenType.EXTERNAL)) {
      while (!p.isAtEnd() && !p.check(TokenType.Semicolon)) {
        children.push(p.advance());
      }
    } else {
      children.push(parseDeclarations(p));
      children.push(parseBlock(p));
    }
  }

  return makeNode("ProcedureBody", children, p.makeRange(start));
}

export function parseFunctionBody(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  const start = children[0] as Token;

  // [schema.]name
  children.push(p.parseQualifiedName());

  // Parameters
  if (p.check(TokenType.LeftParen)) {
    children.push(parseParameterList(p));
  }

  // RETURN type
  children.push(p.expect(TokenType.RETURN));
  children.push(p.parseDataType());

  // Optional DETERMINISTIC, PIPELINED, PARALLEL_ENABLE, RESULT_CACHE, AGGREGATE USING
  while (p.checkKeyword(TokenType.DETERMINISTIC, TokenType.PIPELINED, TokenType.PARALLEL_ENABLE,
                          TokenType.RESULT_CACHE, TokenType.AGGREGATE, TokenType.AUTHID,
                          TokenType.ACCESSIBLE, TokenType.DEFAULT, TokenType.SHARING)) {
    children.push(p.advance());
    // Some have sub-clauses — consume until IS/AS/;
    if (p.tokens[p.pos - 1].type === TokenType.RESULT_CACHE) {
      if (p.check(TokenType.RELIES_ON)) {
        children.push(p.advance());
        if (p.check(TokenType.LeftParen)) {
          children.push(p.parseParenthesized(() =>
            p.parseCommaSeparated(() => p.parseQualifiedName())
          ));
        }
      }
    }
    if (p.tokens[p.pos - 1].type === TokenType.AGGREGATE) {
      if (p.match(TokenType.USING)) {
        children.push(p.tokens[p.pos - 1]);
        children.push(p.parseQualifiedName());
        return makeNode("FunctionBody", children, p.makeRange(start));
      }
    }
  }

  // IS/AS
  if (p.matchKeyword(TokenType.IS, TokenType.AS)) {
    children.push(p.tokens[p.pos - 1]);

    if (p.checkKeyword(TokenType.LANGUAGE, TokenType.EXTERNAL)) {
      while (!p.isAtEnd() && !p.check(TokenType.Semicolon)) {
        children.push(p.advance());
      }
    } else {
      children.push(parseDeclarations(p));
      children.push(parseBlock(p));
    }
  }

  return makeNode("FunctionBody", children, p.makeRange(start));
}

export function parsePackageSpec(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  const start = children[0] as Token;

  children.push(p.parseQualifiedName());

  // Optional AUTHID, ACCESSIBLE BY, etc.
  while (p.checkKeyword(TokenType.AUTHID, TokenType.ACCESSIBLE, TokenType.DEFAULT, TokenType.SHARING)) {
    while (!p.isAtEnd() && !p.checkKeyword(TokenType.IS, TokenType.AS) && !p.check(TokenType.Semicolon)) {
      children.push(p.advance());
    }
  }

  if (p.matchKeyword(TokenType.IS, TokenType.AS)) {
    children.push(p.tokens[p.pos - 1]);
  }

  // Package declarations until END
  children.push(parseDeclarations(p));

  children.push(p.expect(TokenType.END));
  if (p.check(TokenType.Identifier) || p.check(TokenType.QuotedIdentifier)) {
    children.push(p.advance());
  }

  return makeNode("PackageSpec", children, p.makeRange(start));
}

export function parsePackageBody(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  const start = children[0] as Token;

  children.push(p.parseQualifiedName());

  while (p.checkKeyword(TokenType.AUTHID, TokenType.ACCESSIBLE, TokenType.DEFAULT, TokenType.SHARING)) {
    while (!p.isAtEnd() && !p.checkKeyword(TokenType.IS, TokenType.AS) && !p.check(TokenType.Semicolon)) {
      children.push(p.advance());
    }
  }

  if (p.matchKeyword(TokenType.IS, TokenType.AS)) {
    children.push(p.tokens[p.pos - 1]);
  }

  children.push(parseDeclarations(p));

  // Optional initialization section: BEGIN ... END
  if (p.check(TokenType.BEGIN)) {
    children.push(parseBlock(p));
  }

  if (p.match(TokenType.END)) {
    children.push(p.tokens[p.pos - 1]);
    if (p.check(TokenType.Identifier) || p.check(TokenType.QuotedIdentifier)) {
      children.push(p.advance());
    }
  }

  return makeNode("PackageBody", children, p.makeRange(start));
}

export function parseTriggerBody(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  const start = children[0] as Token;

  children.push(p.parseQualifiedName());

  // Trigger timing and events — consume until BEGIN/DECLARE/CALL/compound trigger keywords
  while (!p.isAtEnd() && !p.check(TokenType.BEGIN) && !p.check(TokenType.DECLARE) &&
         !p.check(TokenType.CALL) && !p.check(TokenType.COMPOUND) && !p.check(TokenType.Semicolon)) {
    children.push(p.advance());
  }

  if (p.check(TokenType.COMPOUND)) {
    // Compound trigger — consume generically until END
    children.push(p.advance()); // COMPOUND
    children.push(p.expect(TokenType.TRIGGER));
    while (!p.isAtEnd() && !p.check(TokenType.END)) {
      children.push(p.advance());
    }
    children.push(p.expect(TokenType.END));
    if (p.check(TokenType.Identifier) || p.check(TokenType.QuotedIdentifier)) {
      children.push(p.advance());
    }
  } else if (p.check(TokenType.CALL)) {
    children.push(p.advance()); // CALL
    children.push(p.parseQualifiedName());
    if (p.check(TokenType.LeftParen)) {
      children.push(p.parseParenthesized(() =>
        p.parseCommaSeparated(() => parseExpression(p))
      ));
    }
  } else if (p.check(TokenType.BEGIN) || p.check(TokenType.DECLARE)) {
    if (p.check(TokenType.DECLARE)) {
      children.push(p.advance());
      children.push(parseDeclarations(p));
    }
    children.push(parseBlock(p));
  }

  return makeNode("TriggerBody", children, p.makeRange(start));
}

export function parseTypeBody(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  const start = children[0] as Token;

  children.push(p.parseQualifiedName());

  // Consume modifiers
  while (p.checkKeyword(TokenType.AUTHID, TokenType.ACCESSIBLE, TokenType.DEFAULT, TokenType.SHARING,
                          TokenType.UNDER, TokenType.FORCE)) {
    while (!p.isAtEnd() && !p.checkKeyword(TokenType.IS, TokenType.AS) && !p.check(TokenType.Semicolon)) {
      children.push(p.advance());
    }
  }

  if (p.matchKeyword(TokenType.IS, TokenType.AS)) {
    children.push(p.tokens[p.pos - 1]);
  }

  // Type body members — consume until END
  while (!p.isAtEnd() && !p.check(TokenType.END)) {
    if (p.check(TokenType.Semicolon)) {
      children.push(p.advance());
      continue;
    }

    if (p.check(TokenType.MEMBER) || p.check(TokenType.STATIC) || p.check(TokenType.MAP) ||
        p.check(TokenType.ORDER) || p.check(TokenType.CONSTRUCTOR) || p.check(TokenType.OVERRIDING)) {
      children.push(p.advance());
      continue;
    }

    if (p.check(TokenType.PROCEDURE)) {
      const procChildren: (SyntaxNode | Token)[] = [p.advance()];
      children.push(parseProcedureBody(p, procChildren));
      continue;
    }

    if (p.check(TokenType.FUNCTION)) {
      const funcChildren: (SyntaxNode | Token)[] = [p.advance()];
      children.push(parseFunctionBody(p, funcChildren));
      continue;
    }

    children.push(p.advance());
  }

  children.push(p.expect(TokenType.END));

  return makeNode("TypeBody", children, p.makeRange(start));
}
