import { Token, TokenType } from "./tokens.js";
import { SyntaxNode, makeNode } from "./ast.js";
import { Parser } from "./parser.js";
import { parseExpression, parseExpressionList } from "./expressions.js";

// ─── SELECT ────────────────────────────────────────────────────────────────

export function parseSelect(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];

  // WITH clause
  if (p.check(TokenType.WITH)) {
    children.push(parseWithClause(p));
  }

  children.push(parseSubquery(p));

  // ORDER BY (at top level)
  if (p.checkKeyword(TokenType.ORDER)) {
    children.push(parseOrderByClause(p));
  }

  // FOR UPDATE
  if (p.check(TokenType.FOR) && p.peek(1).type === TokenType.UPDATE) {
    children.push(parseForUpdateClause(p));
  }

  return makeNode("SelectStatement", children, p.makeRange(start));
}

function parseWithClause(p: Parser): SyntaxNode {
  const start = p.advance(); // WITH
  const children: (SyntaxNode | Token)[] = [start];

  // Could be WITH FUNCTION / PROCEDURE (PL/SQL inline)
  if (p.checkKeyword(TokenType.FUNCTION, TokenType.PROCEDURE)) {
    // Skip inline PL/SQL for now — consume until SELECT
    while (!p.isAtEnd() && !p.check(TokenType.SELECT)) {
      children.push(p.advance());
    }
    return makeNode("WithClause", children, p.makeRange(start));
  }

  // CTE list
  children.push(...p.parseCommaSeparated(() => parseCTE(p)));

  return makeNode("WithClause", children, p.makeRange(start));
}

function parseCTE(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];

  children.push(p.parseIdentifier()); // CTE name

  // Optional column list
  if (p.check(TokenType.LeftParen)) {
    children.push(p.parseParenthesized(() =>
      p.parseCommaSeparated(() => p.parseIdentifier())
    ));
  }

  children.push(p.expect(TokenType.AS));

  // Optional MATERIALIZED / NOT MATERIALIZED
  if (p.match(TokenType.NOT)) {
    children.push(p.tokens[p.pos - 1]);
  }
  if (p.match(TokenType.MATERIALIZED)) {
    children.push(p.tokens[p.pos - 1]);
  }

  // Subquery in parens
  children.push(p.expect(TokenType.LeftParen));
  children.push(parseSubquery(p));
  children.push(p.expect(TokenType.RightParen));

  // Optional search/cycle clauses
  if (p.check(TokenType.SEARCH)) {
    children.push(parseSearchClause(p));
  }
  if (p.check(TokenType.CYCLE)) {
    children.push(parseCycleClause(p));
  }

  return makeNode("CommonTableExpression", children, p.makeRange(start));
}

function parseSearchClause(p: Parser): SyntaxNode {
  const start = p.advance(); // SEARCH
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.advance()); // DEPTH or BREADTH
  children.push(p.expect(TokenType.FIRST));
  children.push(p.expect(TokenType.BY));
  children.push(...p.parseCommaSeparated(() => p.parseIdentifier()));
  children.push(p.expect(TokenType.SET));
  children.push(p.parseIdentifier());
  return makeNode("SearchClause", children, p.makeRange(start));
}

function parseCycleClause(p: Parser): SyntaxNode {
  const start = p.advance(); // CYCLE
  const children: (SyntaxNode | Token)[] = [start];
  children.push(...p.parseCommaSeparated(() => p.parseIdentifier()));
  children.push(p.expect(TokenType.SET));
  children.push(p.parseIdentifier());
  children.push(p.expect(TokenType.TO));
  children.push(parseExpression(p));
  children.push(p.expect(TokenType.DEFAULT));
  children.push(parseExpression(p));
  return makeNode("CycleClause", children, p.makeRange(start));
}

function parseSubquery(p: Parser): SyntaxNode {
  const start = p.peek();
  let left = parseQueryBlock(p);

  // UNION [ALL] / INTERSECT / MINUS / EXCEPT
  while (p.checkKeyword(TokenType.UNION, TokenType.INTERSECT, TokenType.MINUS, TokenType.EXCEPT)) {
    const op = p.advance();
    const children: (SyntaxNode | Token)[] = [left, op];
    if (op.type === TokenType.UNION && p.match(TokenType.ALL)) {
      children.push(p.tokens[p.pos - 1]);
    }
    children.push(parseQueryBlock(p));
    left = makeNode("SetOperation", children, p.makeRange(start));
  }

  return left;
}

function parseQueryBlock(p: Parser): SyntaxNode {
  // Could be a parenthesized subquery
  if (p.check(TokenType.LeftParen)) {
    const lp = p.advance();
    const sub = parseSubquery(p);
    const rp = p.expect(TokenType.RightParen);
    return makeNode("ParenSubquery", [lp, sub, rp], p.makeRange(lp));
  }

  const start = p.expect(TokenType.SELECT);
  const children: (SyntaxNode | Token)[] = [start];

  // DISTINCT / UNIQUE / ALL
  if (p.matchKeyword(TokenType.DISTINCT, TokenType.UNIQUE, TokenType.ALL)) {
    children.push(p.tokens[p.pos - 1]);
  }

  // Hints: /*+ ... */
  if (p.check(TokenType.HintComment)) {
    children.push(p.advance());
  }

  // Select list
  children.push(parseSelectList(p));

  // INTO clause (PL/SQL)
  if (p.check(TokenType.INTO) || p.check(TokenType.BULK)) {
    children.push(parseIntoClause(p));
  }

  // FROM clause
  let hasFrom = false;
  if (p.match(TokenType.FROM)) {
    hasFrom = true;
    children.push(p.tokens[p.pos - 1]);
    children.push(parseTableRefList(p));
  }

  // Detect missing FROM when subsequent clauses suggest it was intended
  if (!hasFrom && (p.check(TokenType.WHERE) || p.check(TokenType.GROUP) ||
      p.check(TokenType.HAVING))) {
    p.addDiagnostic(p.peek(), "Missing FROM clause before " + p.peek().text.toUpperCase());
  }

  // WHERE clause
  if (p.match(TokenType.WHERE)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseExpression(p));
  }

  // Hierarchical query: CONNECT BY / START WITH (can appear in either order)
  if (p.check(TokenType.CONNECT) || p.check(TokenType.START)) {
    children.push(parseHierarchicalClause(p));
  }

  // GROUP BY clause
  if (p.check(TokenType.GROUP)) {
    children.push(parseGroupByClause(p));
  }

  // HAVING clause
  if (p.match(TokenType.HAVING)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseExpression(p));
  }

  // MODEL clause — skip for now, complex
  if (p.check(TokenType.MODEL)) {
    children.push(parseModelClause(p));
  }

  // ORDER BY (can be inside subquery)
  if (p.check(TokenType.ORDER)) {
    children.push(parseOrderByClause(p));
  }

  // OFFSET / FETCH (row limiting)
  if (p.check(TokenType.OFFSET)) {
    children.push(parseOffsetFetchClause(p));
  } else if (p.check(TokenType.FETCH)) {
    children.push(parseFetchClause(p));
  }

  return makeNode("QueryBlock", children, p.makeRange(start));
}

function parseSelectList(p: Parser): SyntaxNode {
  const start = p.peek();
  const items = p.parseCommaSeparated(() => parseSelectItem(p));
  return makeNode("SelectList", items, p.makeRange(start));
}

function parseSelectItem(p: Parser): SyntaxNode {
  const start = p.peek();
  const expr = parseExpression(p);
  const children: (SyntaxNode | Token)[] = [expr];

  // Alias: [AS] identifier
  if (p.match(TokenType.AS)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.parseIdentifier());
  } else if (p.check(TokenType.Identifier) || p.check(TokenType.QuotedIdentifier)) {
    // Implicit alias (no AS keyword)
    // But be careful not to consume FROM, WHERE, etc. as aliases
    const next = p.peek();
    if (next.type === TokenType.Identifier || next.type === TokenType.QuotedIdentifier) {
      children.push(p.advance());
    }
  }

  return makeNode("SelectItem", children, p.makeRange(start));
}

function parseIntoClause(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];

  if (p.match(TokenType.BULK)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.expect(TokenType.COLLECT));
  }

  children.push(p.expect(TokenType.INTO));
  children.push(...p.parseCommaSeparated(() => parseExpression(p)));

  return makeNode("IntoClause", children, p.makeRange(start));
}

function parseTableRefList(p: Parser): SyntaxNode {
  const start = p.peek();
  const items = p.parseCommaSeparated(() => parseTableRef(p));
  return makeNode("TableRefList", items, p.makeRange(start));
}

function parseTableRef(p: Parser): SyntaxNode {
  const start = p.peek();
  let left = parseTablePrimary(p);

  // JOINs
  while (isJoinKeyword(p)) {
    left = parseJoin(p, left);
  }

  return left;
}

function parseTablePrimary(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];

  // Parenthesized subquery or join
  if (p.check(TokenType.LeftParen)) {
    const lp = p.advance();
    if (p.check(TokenType.SELECT) || p.check(TokenType.WITH)) {
      const sub = parseSelect(p);
      const rp = p.expect(TokenType.RightParen);
      children.push(lp, sub, rp);
    } else {
      const inner = parseTableRef(p);
      const rp = p.expect(TokenType.RightParen);
      children.push(lp, inner, rp);
    }
  } else if (p.check(TokenType.TABLE) && p.peek(1).type === TokenType.LeftParen) {
    // TABLE(collection_expression)
    children.push(p.advance()); // TABLE
    children.push(p.parseParenthesized(() => [parseExpression(p)]));
  } else if (p.check(TokenType.LATERAL)) {
    children.push(p.advance()); // LATERAL
    if (p.check(TokenType.LeftParen)) {
      const lp = p.advance();
      const sub = parseSelect(p);
      const rp = p.expect(TokenType.RightParen);
      children.push(lp, sub, rp);
    }
  } else if (p.check(TokenType.XMLTABLE) || p.check(TokenType.JSON_TABLE)) {
    // Special table functions with complex syntax (PASSING, COLUMNS, PATH, etc.)
    // Consume the keyword and then generically consume the parenthesized spec
    children.push(p.advance()); // JSON_TABLE or XMLTABLE
    if (p.check(TokenType.LeftParen)) {
      children.push(p.parseParenthesized(() => {
        const inner: (SyntaxNode | Token)[] = [];
        let depth = 0;
        while (!p.isAtEnd()) {
          if (p.check(TokenType.LeftParen)) depth++;
          if (p.check(TokenType.RightParen)) {
            if (depth === 0) break;
            depth--;
          }
          inner.push(p.advance());
        }
        return inner;
      }));
    }
  } else {
    // Regular table name: [schema.]table[@dblink]
    children.push(p.parseQualifiedName());

    // @dblink
    if (p.match(TokenType.AtSign)) {
      children.push(p.tokens[p.pos - 1]);
      children.push(p.parseIdentifier());
    }

    // Flashback: AS OF TIMESTAMP/SCN or VERSIONS BETWEEN
    if (p.check(TokenType.AS) && p.peek(1).type === TokenType.OF) {
      children.push(p.advance()); // AS
      children.push(p.advance()); // OF
      // TIMESTAMP or SCN
      if (p.matchKeyword(TokenType.TIMESTAMP, TokenType.SCN)) {
        children.push(p.tokens[p.pos - 1]);
      }
      children.push(parseExpression(p));
    }
    if (p.check(TokenType.VERSIONS)) {
      children.push(p.advance()); // VERSIONS
      children.push(p.expect(TokenType.BETWEEN));
      // TIMESTAMP or SCN (optional qualifier)
      if (p.matchKeyword(TokenType.TIMESTAMP, TokenType.SCN)) {
        children.push(p.tokens[p.pos - 1]);
      }
      // Parse lower bound at precedence above AND (2) so AND is not consumed
      // as part of a boolean expression inside the boundary expression.
      children.push(parseExpression(p, 2));
      children.push(p.expect(TokenType.AND));
      children.push(parseExpression(p));
    }
  }

  // PARTITION / SUBPARTITION
  if (p.checkKeyword(TokenType.PARTITION, TokenType.SUBPARTITION)) {
    children.push(p.advance());
    if (p.check(TokenType.LeftParen)) {
      children.push(p.parseParenthesized(() => p.parseCommaSeparated(() => p.parseIdentifier())));
    }
  }

  // SAMPLE
  if (p.match(TokenType.SAMPLE)) {
    children.push(p.tokens[p.pos - 1]);
    if (p.match(TokenType.BLOCK)) children.push(p.tokens[p.pos - 1]);
    if (p.check(TokenType.LeftParen)) {
      children.push(p.parseParenthesized(() => [parseExpression(p)]));
    }
  }

  // PIVOT / UNPIVOT
  if (p.check(TokenType.PIVOT) || p.check(TokenType.UNPIVOT)) {
    children.push(parsePivotClause(p));
  }

  // Alias
  const alias = parseOptionalAlias(p);
  if (alias) children.push(alias);

  return makeNode("TableRef", children, p.makeRange(start));
}

function parsePivotClause(p: Parser): SyntaxNode {
  const start = p.advance(); // PIVOT or UNPIVOT
  const children: (SyntaxNode | Token)[] = [start];

  if (start.type === TokenType.UNPIVOT) {
    // Optional INCLUDE/EXCLUDE NULLS
    if (p.matchKeyword(TokenType.INCLUDE, TokenType.EXCLUDE)) {
      children.push(p.tokens[p.pos - 1]);
      children.push(p.expect(TokenType.NULLS));
    }
  }

  // XML keyword for PIVOT XML
  if (p.match(TokenType.XML)) {
    children.push(p.tokens[p.pos - 1]);
  }

  // Parenthesized pivot spec — consume generically
  if (p.check(TokenType.LeftParen)) {
    children.push(p.parseParenthesized(() => {
      const inner: (SyntaxNode | Token)[] = [];
      // Consume everything inside parens (pivot specs are complex)
      let depth = 0;
      while (!p.isAtEnd()) {
        if (p.check(TokenType.LeftParen)) depth++;
        if (p.check(TokenType.RightParen)) {
          if (depth === 0) break;
          depth--;
        }
        inner.push(p.advance());
      }
      return inner;
    }));
  }

  return makeNode("PivotClause", children, p.makeRange(start));
}

function isJoinKeyword(p: Parser): boolean {
  const t = p.peek().type;
  if (t === TokenType.JOIN || t === TokenType.CROSS || t === TokenType.NATURAL) return true;
  if (t === TokenType.INNER) return true;
  if (t === TokenType.LEFT || t === TokenType.RIGHT || t === TokenType.FULL) return true;
  if (t === TokenType.OUTER && p.peek(1).type === TokenType.JOIN) return true;
  if (p.check(TokenType.Comma)) return false;
  return false;
}

function parseJoin(p: Parser, left: SyntaxNode): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [left];

  // Optional: NATURAL
  if (p.match(TokenType.NATURAL)) children.push(p.tokens[p.pos - 1]);

  // Optional: INNER / LEFT [OUTER] / RIGHT [OUTER] / FULL [OUTER] / CROSS
  if (p.matchKeyword(TokenType.INNER, TokenType.CROSS, TokenType.LEFT, TokenType.RIGHT, TokenType.FULL)) {
    children.push(p.tokens[p.pos - 1]);
    if (p.match(TokenType.OUTER)) children.push(p.tokens[p.pos - 1]);
  }

  // Optional APPLY (CROSS APPLY / OUTER APPLY)
  if (p.match(TokenType.APPLY)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseTablePrimary(p));
    return makeNode("ApplyJoin", children, p.makeRange(start));
  }

  children.push(p.expect(TokenType.JOIN));
  children.push(parseTablePrimary(p));

  // ON / USING
  if (p.match(TokenType.ON)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseExpression(p));
  } else if (p.check(TokenType.USING)) {
    children.push(p.advance());
    children.push(p.parseParenthesized(() => p.parseCommaSeparated(() => p.parseIdentifier())));
  }

  return makeNode("JoinClause", children, p.makeRange(start));
}

function parseHierarchicalClause(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];

  // Can be: START WITH ... CONNECT BY ... or CONNECT BY ... START WITH ...
  if (p.match(TokenType.START)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.expect(TokenType.WITH));
    children.push(parseExpression(p));
  }

  if (p.match(TokenType.CONNECT)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.expect(TokenType.BY));
    if (p.match(TokenType.NOCYCLE)) children.push(p.tokens[p.pos - 1]);
    children.push(parseExpression(p));
  }

  // START WITH after CONNECT BY
  if (p.match(TokenType.START)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.expect(TokenType.WITH));
    children.push(parseExpression(p));
  }

  return makeNode("HierarchicalClause", children, p.makeRange(start));
}

function parseGroupByClause(p: Parser): SyntaxNode {
  const start = p.advance(); // GROUP
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.expect(TokenType.BY));

  children.push(...p.parseCommaSeparated(() => parseGroupByElement(p)));

  return makeNode("GroupByClause", children, p.makeRange(start));
}

function parseGroupByElement(p: Parser): SyntaxNode {
  const start = p.peek();

  // ROLLUP(...)
  if (p.check(TokenType.ROLLUP) && p.peek(1).type === TokenType.LeftParen) {
    const kw = p.advance();
    const paren = p.parseParenthesized(() => p.parseCommaSeparated(() => parseExpression(p)));
    return makeNode("Rollup", [kw, paren], p.makeRange(start));
  }

  // CUBE(...)
  if (p.check(TokenType.CUBE) && p.peek(1).type === TokenType.LeftParen) {
    const kw = p.advance();
    const paren = p.parseParenthesized(() => p.parseCommaSeparated(() => parseExpression(p)));
    return makeNode("Cube", [kw, paren], p.makeRange(start));
  }

  // GROUPING SETS(...)
  if (p.check(TokenType.GROUPING) && p.peek(1).type === TokenType.SETS) {
    const kw1 = p.advance();
    const kw2 = p.advance();
    const paren = p.parseParenthesized(() => p.parseCommaSeparated(() => parseGroupByElement(p)));
    return makeNode("GroupingSets", [kw1, kw2, paren], p.makeRange(start));
  }

  // Parenthesized expression list (for composite grouping)
  if (p.check(TokenType.LeftParen)) {
    return p.parseParenthesized(() => p.parseCommaSeparated(() => parseExpression(p)));
  }

  return parseExpression(p);
}

export function parseOrderByClause(p: Parser): SyntaxNode {
  const start = p.advance(); // ORDER
  const children: (SyntaxNode | Token)[] = [start];

  if (p.match(TokenType.SIBLINGS)) {
    children.push(p.tokens[p.pos - 1]);
  }

  children.push(p.expect(TokenType.BY));
  children.push(...p.parseCommaSeparated(() => parseOrderByItem(p)));

  return makeNode("OrderByClause", children, p.makeRange(start));
}

function parseOrderByItem(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];

  children.push(parseExpression(p));

  // ASC / DESC
  if (p.matchKeyword(TokenType.ASC, TokenType.DESC)) {
    children.push(p.tokens[p.pos - 1]);
  }

  // NULLS FIRST / NULLS LAST
  if (p.match(TokenType.NULLS)) {
    children.push(p.tokens[p.pos - 1]);
    if (p.matchKeyword(TokenType.FIRST, TokenType.LAST)) {
      children.push(p.tokens[p.pos - 1]);
    }
  }

  return makeNode("OrderByItem", children, p.makeRange(start));
}

function parseForUpdateClause(p: Parser): SyntaxNode {
  const start = p.advance(); // FOR
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.expect(TokenType.UPDATE));

  if (p.match(TokenType.OF)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(...p.parseCommaSeparated(() => p.parseQualifiedName()));
  }

  if (p.matchKeyword(TokenType.NOWAIT, TokenType.WAIT, TokenType.SKIP_)) {
    children.push(p.tokens[p.pos - 1]);
    if (p.tokens[p.pos - 1].type === TokenType.WAIT) {
      children.push(parseExpression(p)); // wait time
    }
    if (p.tokens[p.pos - 1].type === TokenType.SKIP_) {
      children.push(p.expect(TokenType.LOCKED));
    }
  }

  return makeNode("ForUpdateClause", children, p.makeRange(start));
}

function parseModelClause(p: Parser): SyntaxNode {
  const start = p.advance(); // MODEL
  const children: (SyntaxNode | Token)[] = [start];
  // Complex — consume until we hit something that's clearly not model syntax
  while (!p.isAtEnd() && !p.check(TokenType.ORDER) && !p.check(TokenType.FETCH) &&
         !p.check(TokenType.OFFSET) && !p.check(TokenType.FOR) &&
         !p.check(TokenType.UNION) && !p.check(TokenType.INTERSECT) &&
         !p.check(TokenType.MINUS) && !p.check(TokenType.EXCEPT) &&
         !p.check(TokenType.RightParen) && !p.check(TokenType.Semicolon)) {
    children.push(p.advance());
  }
  return makeNode("ModelClause", children, p.makeRange(start));
}

function parseOffsetFetchClause(p: Parser): SyntaxNode {
  const start = p.advance(); // OFFSET
  const children: (SyntaxNode | Token)[] = [start];
  children.push(parseExpression(p));
  if (p.matchKeyword(TokenType.ROW, TokenType.ROWS)) {
    children.push(p.tokens[p.pos - 1]);
  }

  if (p.check(TokenType.FETCH)) {
    children.push(parseFetchClause(p));
  }

  return makeNode("OffsetFetchClause", children, p.makeRange(start));
}

function parseFetchClause(p: Parser): SyntaxNode {
  const start = p.advance(); // FETCH
  const children: (SyntaxNode | Token)[] = [start];
  if (p.matchKeyword(TokenType.FIRST, TokenType.NEXT)) {
    children.push(p.tokens[p.pos - 1]);
  }
  if (!p.checkKeyword(TokenType.ROW, TokenType.ROWS)) {
    children.push(parseExpression(p));
  }
  if (p.matchKeyword(TokenType.ROW, TokenType.ROWS)) {
    children.push(p.tokens[p.pos - 1]);
  }
  if (p.matchKeyword(TokenType.ONLY, TokenType.WITH)) {
    children.push(p.tokens[p.pos - 1]);
    if (p.tokens[p.pos - 1].type === TokenType.WITH) {
      children.push(p.expect(TokenType.TIES));
    }
  }
  return makeNode("FetchClause", children, p.makeRange(start));
}

function parseOptionalAlias(p: Parser): SyntaxNode | null {
  if (p.match(TokenType.AS)) {
    const asKw = p.tokens[p.pos - 1];
    const name = p.parseIdentifier();
    return makeNode("Alias", [asKw, name], p.makeRange(asKw));
  }

  // Implicit alias — identifier that's not a keyword that starts a clause
  if (p.check(TokenType.Identifier) || p.check(TokenType.QuotedIdentifier)) {
    const name = p.advance();
    return makeNode("Alias", [name], p.makeRange(name));
  }

  return null;
}

// ─── INSERT ────────────────────────────────────────────────────────────────

export function parseInsert(p: Parser): SyntaxNode {
  const start = p.advance(); // INSERT
  const children: (SyntaxNode | Token)[] = [start];

  // Hints: /*+ ... */
  if (p.check(TokenType.HintComment)) {
    children.push(p.advance());
  }

  // Multi-table insert: INSERT ALL/FIRST ... SELECT ...
  if (p.checkKeyword(TokenType.ALL, TokenType.FIRST)) {
    return parseMultiTableInsert(p, start, children);
  }

  children.push(p.expect(TokenType.INTO));
  children.push(p.parseQualifiedName());

  // Optional alias
  const alias = parseOptionalAlias(p);
  if (alias) children.push(alias);

  // Optional column list
  if (p.check(TokenType.LeftParen)) {
    children.push(p.parseParenthesized(() =>
      p.parseCommaSeparated(() => p.parseIdentifier())
    ));
  }

  // VALUES clause or subquery
  if (p.match(TokenType.VALUES)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.parseParenthesized(() =>
      p.parseCommaSeparated(() => parseExpression(p))
    ));
  } else if (p.check(TokenType.SELECT) || p.check(TokenType.WITH) || p.check(TokenType.LeftParen)) {
    children.push(parseSelect(p));
  }

  // RETURNING clause
  if (p.check(TokenType.RETURNING) || p.check(TokenType.RETURN)) {
    children.push(parseReturningClause(p));
  }

  return makeNode("InsertStatement", children, p.makeRange(start));
}

function parseMultiTableInsert(p: Parser, start: Token, children: (SyntaxNode | Token)[]): SyntaxNode {
  children.push(p.advance()); // ALL or FIRST

  while (p.check(TokenType.INTO) || p.check(TokenType.WHEN) || p.check(TokenType.ELSE)) {
    if (p.match(TokenType.WHEN)) {
      const whenChildren: (SyntaxNode | Token)[] = [p.tokens[p.pos - 1]];
      whenChildren.push(parseExpression(p));
      whenChildren.push(p.expect(TokenType.THEN));
      while (p.check(TokenType.INTO)) {
        whenChildren.push(parseInsertIntoClause(p));
      }
      children.push(makeNode("WhenInsertClause", whenChildren, p.makeRange(p.tokens[p.pos - 1])));
    } else if (p.match(TokenType.ELSE)) {
      const elseChildren: (SyntaxNode | Token)[] = [p.tokens[p.pos - 1]];
      while (p.check(TokenType.INTO)) {
        elseChildren.push(parseInsertIntoClause(p));
      }
      children.push(makeNode("ElseInsertClause", elseChildren, p.makeRange(p.tokens[p.pos - 1])));
    } else if (p.check(TokenType.INTO)) {
      children.push(parseInsertIntoClause(p));
    }
  }

  // Subquery
  if (p.check(TokenType.SELECT) || p.check(TokenType.WITH)) {
    children.push(parseSelect(p));
  }

  return makeNode("MultiTableInsert", children, p.makeRange(start));
}

function parseInsertIntoClause(p: Parser): SyntaxNode {
  const start = p.advance(); // INTO
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.parseQualifiedName());

  if (p.check(TokenType.LeftParen)) {
    children.push(p.parseParenthesized(() =>
      p.parseCommaSeparated(() => p.parseIdentifier())
    ));
  }

  if (p.match(TokenType.VALUES)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.parseParenthesized(() =>
      p.parseCommaSeparated(() => parseExpression(p))
    ));
  }

  return makeNode("InsertIntoClause", children, p.makeRange(start));
}

// ─── UPDATE ────────────────────────────────────────────────────────────────

export function parseUpdate(p: Parser): SyntaxNode {
  const start = p.advance(); // UPDATE
  const children: (SyntaxNode | Token)[] = [start];

  // Hints: /*+ ... */
  if (p.check(TokenType.HintComment)) {
    children.push(p.advance());
  }

  children.push(p.parseQualifiedName());

  // Optional alias
  const alias = parseOptionalAlias(p);
  if (alias) children.push(alias);

  // SET clause
  children.push(p.expect(TokenType.SET));
  children.push(...p.parseCommaSeparated(() => parseSetItem(p)));

  // WHERE clause
  if (p.match(TokenType.WHERE)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseExpression(p));
  }

  // RETURNING clause
  if (p.check(TokenType.RETURNING) || p.check(TokenType.RETURN)) {
    children.push(parseReturningClause(p));
  }

  return makeNode("UpdateStatement", children, p.makeRange(start));
}

function parseSetItem(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];

  if (p.check(TokenType.LeftParen)) {
    // (col1, col2, ...) = (subquery)
    children.push(p.parseParenthesized(() =>
      p.parseCommaSeparated(() => p.parseQualifiedName())
    ));
    children.push(p.expect(TokenType.Equals));
    children.push(p.parseParenthesized(() => {
      if (p.check(TokenType.SELECT) || p.check(TokenType.WITH)) {
        return [parseSelect(p)];
      }
      return p.parseCommaSeparated(() => parseExpression(p));
    }));
  } else {
    children.push(p.parseQualifiedName());
    children.push(p.expect(TokenType.Equals));
    if (p.check(TokenType.LeftParen) && (p.peek(1).type === TokenType.SELECT || p.peek(1).type === TokenType.WITH)) {
      children.push(p.parseParenthesized(() => [parseSelect(p)]));
    } else {
      children.push(parseExpression(p));
    }
  }

  return makeNode("SetItem", children, p.makeRange(start));
}

// ─── DELETE ────────────────────────────────────────────────────────────────

export function parseDelete(p: Parser): SyntaxNode {
  const start = p.advance(); // DELETE
  const children: (SyntaxNode | Token)[] = [start];

  // Hints: /*+ ... */
  if (p.check(TokenType.HintComment)) {
    children.push(p.advance());
  }

  // Optional FROM
  p.match(TokenType.FROM);

  children.push(p.parseQualifiedName());

  // Optional alias
  const alias = parseOptionalAlias(p);
  if (alias) children.push(alias);

  // WHERE clause
  if (p.match(TokenType.WHERE)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseExpression(p));
  }

  // RETURNING clause
  if (p.check(TokenType.RETURNING) || p.check(TokenType.RETURN)) {
    children.push(parseReturningClause(p));
  }

  return makeNode("DeleteStatement", children, p.makeRange(start));
}

// ─── MERGE ─────────────────────────────────────────────────────────────────

export function parseMerge(p: Parser): SyntaxNode {
  const start = p.advance(); // MERGE
  const children: (SyntaxNode | Token)[] = [start];

  // Hints: /*+ ... */
  if (p.check(TokenType.HintComment)) {
    children.push(p.advance());
  }

  children.push(p.expect(TokenType.INTO));
  children.push(p.parseQualifiedName());

  // Optional alias
  const alias = parseOptionalAlias(p);
  if (alias) children.push(alias);

  children.push(p.expect(TokenType.USING));

  // Source: table or subquery
  if (p.check(TokenType.LeftParen)) {
    children.push(p.parseParenthesized(() => [parseSelect(p)]));
  } else {
    children.push(p.parseQualifiedName());
  }

  // Source alias
  const srcAlias = parseOptionalAlias(p);
  if (srcAlias) children.push(srcAlias);

  children.push(p.expect(TokenType.ON));
  children.push(p.parseParenthesized(() => [parseExpression(p)]));

  // WHEN MATCHED / WHEN NOT MATCHED clauses
  while (p.check(TokenType.WHEN)) {
    children.push(parseMergeWhenClause(p));
  }

  return makeNode("MergeStatement", children, p.makeRange(start));
}

function parseMergeWhenClause(p: Parser): SyntaxNode {
  const start = p.advance(); // WHEN
  const children: (SyntaxNode | Token)[] = [start];

  const notKw = p.match(TokenType.NOT);
  if (notKw) children.push(notKw);

  children.push(p.expect(TokenType.MATCHED));

  if (p.match(TokenType.THEN)) {
    children.push(p.tokens[p.pos - 1]);
  }

  // UPDATE SET ... or INSERT (...) VALUES (...) or DELETE
  if (p.check(TokenType.UPDATE)) {
    children.push(p.advance());
    children.push(p.expect(TokenType.SET));
    children.push(...p.parseCommaSeparated(() => parseSetItem(p)));

    if (p.match(TokenType.WHERE)) {
      children.push(p.tokens[p.pos - 1]);
      children.push(parseExpression(p));
    }
    if (p.match(TokenType.DELETE)) {
      children.push(p.tokens[p.pos - 1]);
      if (p.match(TokenType.WHERE)) {
        children.push(p.tokens[p.pos - 1]);
        children.push(parseExpression(p));
      }
    }
  } else if (p.check(TokenType.INSERT)) {
    children.push(p.advance());
    if (p.check(TokenType.LeftParen)) {
      children.push(p.parseParenthesized(() =>
        p.parseCommaSeparated(() => p.parseIdentifier())
      ));
    }
    children.push(p.expect(TokenType.VALUES));
    children.push(p.parseParenthesized(() =>
      p.parseCommaSeparated(() => parseExpression(p))
    ));
    if (p.match(TokenType.WHERE)) {
      children.push(p.tokens[p.pos - 1]);
      children.push(parseExpression(p));
    }
  } else if (p.check(TokenType.DELETE)) {
    children.push(p.advance());
    if (p.match(TokenType.WHERE)) {
      children.push(p.tokens[p.pos - 1]);
      children.push(parseExpression(p));
    }
  }

  return makeNode("MergeWhenClause", children, p.makeRange(start));
}

// ─── LOCK TABLE ────────────────────────────────────────────────────────────

export function parseLockTable(p: Parser): SyntaxNode {
  const start = p.advance(); // LOCK
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.expect(TokenType.TABLE));
  children.push(...p.parseCommaSeparated(() => p.parseQualifiedName()));

  children.push(p.expect(TokenType.IN));

  // Lock mode: ROW SHARE, ROW EXCLUSIVE, SHARE UPDATE, SHARE, SHARE ROW EXCLUSIVE, EXCLUSIVE
  while (!p.isAtEnd() && !p.check(TokenType.MODE) && !p.check(TokenType.Semicolon)) {
    children.push(p.advance());
  }
  children.push(p.expect(TokenType.MODE));

  if (p.match(TokenType.NOWAIT)) {
    children.push(p.tokens[p.pos - 1]);
  } else if (p.match(TokenType.WAIT)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseExpression(p));
  }

  return makeNode("LockTableStatement", children, p.makeRange(start));
}

// ─── EXPLAIN PLAN ──────────────────────────────────────────────────────────

export function parseExplainPlan(p: Parser): SyntaxNode {
  const start = p.advance(); // EXPLAIN
  const children: (SyntaxNode | Token)[] = [start];
  children.push(p.expect(TokenType.PLAN));

  if (p.match(TokenType.SET)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.expect(TokenType.STATEMENT_ID));
    children.push(p.expect(TokenType.Equals));
    children.push(parseExpression(p));
  }

  if (p.match(TokenType.INTO)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.parseQualifiedName());
  }

  children.push(p.expect(TokenType.FOR));

  // The explained statement
  const stmt = p.parseStatement();
  if (stmt) children.push(stmt);

  return makeNode("ExplainPlanStatement", children, p.makeRange(start));
}

// ─── RETURNING clause ──────────────────────────────────────────────────────

function parseReturningClause(p: Parser): SyntaxNode {
  const start = p.advance(); // RETURNING or RETURN
  const children: (SyntaxNode | Token)[] = [start];

  children.push(...p.parseCommaSeparated(() => parseExpression(p)));

  if (p.match(TokenType.INTO)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(...p.parseCommaSeparated(() => parseExpression(p)));
  } else if (p.match(TokenType.BULK)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.expect(TokenType.COLLECT));
    children.push(p.expect(TokenType.INTO));
    children.push(...p.parseCommaSeparated(() => parseExpression(p)));
  }

  return makeNode("ReturningClause", children, p.makeRange(start));
}
