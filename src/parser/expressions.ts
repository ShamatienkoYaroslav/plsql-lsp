import { Token, TokenType } from "./tokens.js";
import { SyntaxNode, makeNode, makeErrorNode } from "./ast.js";
import { Parser } from "./parser.js";

// Precedence levels (low to high)
const enum Prec {
  None = 0,
  Or = 1,
  And = 2,
  Not = 3,
  Comparison = 4,  // IS, IN, BETWEEN, LIKE
  Relational = 5,  // =, <>, !=, <, >, <=, >=
  Concat = 6,      // ||
  Additive = 7,    // +, -
  Multiplicative = 8, // *, /, MOD
  Exponent = 9,    // **
  Unary = 10,      // +, -, PRIOR, CONNECT_BY_ROOT, NOT, etc.
  Postfix = 11,    // .field, (args), collection methods
}

export function parseExpression(p: Parser, minPrec: number = Prec.None): SyntaxNode {
  let left = parsePrefixExpression(p);

  while (true) {
    const prec = getInfixPrecedence(p);
    if (prec <= minPrec) break;
    left = parseInfixExpression(p, left, prec);
  }

  return left;
}

export function parseExpressionList(p: Parser): SyntaxNode {
  const start = p.peek();
  const items = p.parseCommaSeparated(() => parseExpression(p));
  return makeNode("ExpressionList", items, p.makeRange(start));
}

function getInfixPrecedence(p: Parser): number {
  const tok = p.peek();
  switch (tok.type) {
    case TokenType.OR: return Prec.Or;
    case TokenType.AND: return Prec.And;

    // Comparison operators (IS, IN, BETWEEN, LIKE, NOT IN, NOT LIKE, etc.)
    case TokenType.IS:
    case TokenType.IN:
    case TokenType.BETWEEN:
    case TokenType.LIKE:
    case TokenType.LIKEC:
    case TokenType.MEMBER:
    case TokenType.SUBMULTISET:
      return Prec.Comparison;

    case TokenType.NOT: {
      // NOT IN, NOT BETWEEN, NOT LIKE, etc.
      const next = p.peek(1).type;
      if (next === TokenType.IN || next === TokenType.BETWEEN || next === TokenType.LIKE ||
          next === TokenType.LIKEC ||
          next === TokenType.MEMBER || next === TokenType.SUBMULTISET) {
        return Prec.Comparison;
      }
      return Prec.None;
    }

    // Relational
    case TokenType.Equals:
    case TokenType.NotEquals:
    case TokenType.LessThan:
    case TokenType.GreaterThan:
    case TokenType.LessThanEquals:
    case TokenType.GreaterThanEquals:
      return Prec.Relational;

    // Concatenation
    case TokenType.Concatenation: return Prec.Concat;

    // Additive
    case TokenType.Plus:
    case TokenType.Minus:
      return Prec.Additive;

    // Multiplicative
    case TokenType.Asterisk:
    case TokenType.Slash:
    case TokenType.MOD:
      return Prec.Multiplicative;

    // Exponentiation
    case TokenType.DoubleAsterisk: return Prec.Exponent;

    // Postfix: dot access
    case TokenType.Dot: return Prec.Postfix;
    case TokenType.Percent: return Prec.Postfix;
    case TokenType.LeftParen: return Prec.Postfix;

    default: return Prec.None;
  }
}

function parsePrefixExpression(p: Parser): SyntaxNode {
  const tok = p.peek();

  // Unary operators
  switch (tok.type) {
    case TokenType.Plus:
    case TokenType.Minus: {
      const op = p.advance();
      const operand = parseExpression(p, Prec.Unary);
      return makeNode("UnaryExpression", [op, operand], p.makeRange(op));
    }

    case TokenType.NOT: {
      // Only unary NOT (not "NOT IN" etc.)
      const next = p.peek(1).type;
      if (next !== TokenType.IN && next !== TokenType.BETWEEN && next !== TokenType.LIKE &&
          next !== TokenType.LIKEC &&
          next !== TokenType.MEMBER && next !== TokenType.SUBMULTISET) {
        const op = p.advance();
        const operand = parseExpression(p, Prec.Not);
        return makeNode("UnaryExpression", [op, operand], p.makeRange(op));
      }
      break;
    }

    case TokenType.PRIOR: {
      const op = p.advance();
      const operand = parseExpression(p, Prec.Unary);
      return makeNode("PriorExpression", [op, operand], p.makeRange(op));
    }

    case TokenType.CONNECT_BY_ROOT: {
      const op = p.advance();
      const operand = parseExpression(p, Prec.Unary);
      return makeNode("ConnectByRootExpression", [op, operand], p.makeRange(op));
    }

    case TokenType.NEW: {
      const op = p.advance();
      const operand = parseExpression(p, Prec.Unary);
      return makeNode("NewExpression", [op, operand], p.makeRange(op));
    }

    case TokenType.DISTINCT:
    case TokenType.UNIQUE:
    case TokenType.ALL: {
      const op = p.advance();
      const operand = parseExpression(p, Prec.Unary);
      return makeNode("SetQuantifierExpression", [op, operand], p.makeRange(op));
    }

    case TokenType.EXISTS: {
      // EXISTS(subquery)
      if (p.peek(1).type === TokenType.LeftParen) {
        const op = p.advance();
        const paren = p.parseParenthesized(() => {
          const inner = parseExpression(p);
          return [inner];
        });
        return makeNode("ExistsExpression", [op, paren], p.makeRange(op));
      }
      break;
    }
  }

  return parseAtom(p);
}

function parseAtom(p: Parser): SyntaxNode {
  const tok = p.peek();

  switch (tok.type) {
    // Literals
    case TokenType.IntegerLiteral:
    case TokenType.NumberLiteral:
    case TokenType.StringLiteral:
    case TokenType.NationalStringLiteral:
    case TokenType.QStringLiteral:
    case TokenType.HexStringLiteral: {
      const lit = p.advance();
      return makeNode("Literal", [lit], p.makeRange(lit));
    }

    case TokenType.NULL_:
    case TokenType.TRUE:
    case TokenType.FALSE: {
      const lit = p.advance();
      return makeNode("Literal", [lit], p.makeRange(lit));
    }

    // Bind variable
    case TokenType.BindVariable: {
      const bv = p.advance();
      return makeNode("BindVariable", [bv], p.makeRange(bv));
    }

    // Inquiry directive
    case TokenType.InquiryDirective: {
      const id = p.advance();
      return makeNode("InquiryDirective", [id], p.makeRange(id));
    }

    // Parenthesized expression or subquery
    case TokenType.LeftParen: {
      const lp = p.advance();
      const children: (SyntaxNode | Token)[] = [lp];

      if (p.check(TokenType.SELECT) || p.check(TokenType.WITH)) {
        // Subquery
        const { parseSelect } = require("./dml.js");
        children.push(parseSelect(p));
      } else {
        // Expression list (could be single expr or tuple)
        children.push(parseExpressionList(p));
      }
      children.push(p.expect(TokenType.RightParen));
      return makeNode("ParenExpression", children, p.makeRange(lp));
    }

    // CASE expression
    case TokenType.CASE:
      return parseCaseExpression(p);

    // CAST expression
    case TokenType.CAST: {
      const kw = p.advance();
      const paren = p.parseParenthesized(() => {
        const children: (SyntaxNode | Token)[] = [];
        if (p.check(TokenType.MULTISET)) {
          children.push(p.advance());
          children.push(p.expect(TokenType.LeftParen));
          children.push(parseExpression(p));
          children.push(p.expect(TokenType.RightParen));
        } else {
          children.push(parseExpression(p));
        }
        children.push(p.expect(TokenType.AS));
        children.push(p.parseDataType());
        return children;
      });
      return makeNode("CastExpression", [kw, paren], p.makeRange(kw));
    }

    // CURSOR expression
    case TokenType.CURSOR: {
      if (p.peek(1).type === TokenType.LeftParen) {
        const kw = p.advance();
        const paren = p.parseParenthesized(() => {
          const { parseSelect } = require("./dml.js");
          return [parseSelect(p)];
        });
        return makeNode("CursorExpression", [kw, paren], p.makeRange(kw));
      }
      break;
    }

    // INTERVAL literal
    case TokenType.INTERVAL: {
      const kw = p.advance();
      const children: (SyntaxNode | Token)[] = [kw];
      children.push(parseExpression(p, Prec.Concat));
      // DAY/YEAR/MONTH/HOUR/MINUTE/SECOND TO ...
      if (p.matchKeyword(TokenType.DAY, TokenType.YEAR, TokenType.MONTH, TokenType.HOUR, TokenType.MINUTE, TokenType.SECOND)) {
        children.push(p.tokens[p.pos - 1]);
        if (p.check(TokenType.LeftParen)) {
          children.push(p.parseParenthesized(() => [parseExpression(p)]));
        }
        if (p.match(TokenType.TO)) {
          children.push(p.tokens[p.pos - 1]);
          children.push(p.advance()); // target unit
          if (p.check(TokenType.LeftParen)) {
            children.push(p.parseParenthesized(() => [parseExpression(p)]));
          }
        }
      }
      return makeNode("IntervalExpression", children, p.makeRange(kw));
    }

    // Multiset operators handled as functions
    case TokenType.MULTISET: {
      const kw = p.advance();
      return makeNode("Identifier", [kw], p.makeRange(kw));
    }

    // TRIM function (special syntax)
    case TokenType.TRIM: {
      const kw = p.advance();
      if (p.check(TokenType.LeftParen)) {
        const paren = p.parseParenthesized(() => {
          const children: (SyntaxNode | Token)[] = [];
          // TRIM(LEADING/TRAILING/BOTH ... FROM ...)
          if (p.checkKeyword(TokenType.LEADING, TokenType.TRAILING, TokenType.BOTH)) {
            children.push(p.advance());
            if (!p.check(TokenType.FROM)) {
              children.push(parseExpression(p));
            }
            children.push(p.expect(TokenType.FROM));
            children.push(parseExpression(p));
          } else {
            children.push(parseExpression(p));
            if (p.match(TokenType.FROM)) {
              children.push(p.tokens[p.pos - 1]);
              children.push(parseExpression(p));
            }
          }
          return children;
        });
        return makeNode("TrimExpression", [kw, paren], p.makeRange(kw));
      }
      return makeNode("Identifier", [kw], p.makeRange(kw));
    }

    // EXTRACT function (special syntax)
    case TokenType.EXTRACT: {
      const kw = p.advance();
      if (p.check(TokenType.LeftParen)) {
        const paren = p.parseParenthesized(() => {
          const children: (SyntaxNode | Token)[] = [];
          children.push(p.advance()); // YEAR/MONTH/DAY/HOUR/MINUTE/SECOND/TIMEZONE_*
          children.push(p.expect(TokenType.FROM));
          children.push(parseExpression(p));
          return children;
        });
        return makeNode("ExtractExpression", [kw, paren], p.makeRange(kw));
      }
      return makeNode("Identifier", [kw], p.makeRange(kw));
    }

    // XMLELEMENT, XMLFOREST, XMLAGG, etc. — treat as function calls
    // Any keyword that's followed by ( can be a function call
    default: {
      // Identifier or keyword-as-identifier
      if (tok.type === TokenType.Identifier || tok.type === TokenType.QuotedIdentifier ||
          isKeywordToken(tok.type)) {
        const id = p.advance();
        return makeNode("Identifier", [id], p.makeRange(id));
      }

      // Asterisk (for SELECT *)
      if (tok.type === TokenType.Asterisk) {
        const star = p.advance();
        return makeNode("Star", [star], p.makeRange(star));
      }

      // Error — unexpected token
      const errTok = p.advance();
      p.addDiagnostic(errTok, `Unexpected token '${errTok.text || errTok.type}' in expression`);
      return makeErrorNode(`Unexpected token '${errTok.text}'`, [errTok], p.makeRange(errTok));
    }
  }

  // Fallback for break cases above
  const id = p.advance();
  return makeNode("Identifier", [id], p.makeRange(id));
}

function parseInfixExpression(p: Parser, left: SyntaxNode, prec: number): SyntaxNode {
  const tok = p.peek();

  switch (tok.type) {
    // Logical
    case TokenType.OR:
    case TokenType.AND: {
      const op = p.advance();
      const right = parseExpression(p, prec);
      return makeNode("BinaryExpression", [left, op, right], p.makeRange(left.range ? { offset: left.range.start.offset, line: left.range.start.line, col: left.range.start.col, type: TokenType.EOF, text: "" } : tok));
    }

    // Relational operators
    case TokenType.Equals:
    case TokenType.NotEquals:
    case TokenType.LessThan:
    case TokenType.GreaterThan:
    case TokenType.LessThanEquals:
    case TokenType.GreaterThanEquals: {
      const op = p.advance();
      // Check for ANY/SOME/ALL (quantified comparison)
      if (p.checkKeyword(TokenType.ANY, TokenType.SOME, TokenType.ALL)) {
        const quant = p.advance();
        const paren = p.parseParenthesized(() => {
          if (p.check(TokenType.SELECT) || p.check(TokenType.WITH)) {
            const { parseSelect } = require("./dml.js");
            return [parseSelect(p)];
          }
          return [parseExpressionList(p)];
        });
        return makeNode("QuantifiedComparison", [left, op, quant, paren], rangeFrom(p, left));
      }
      const right = parseExpression(p, prec);
      return makeNode("BinaryExpression", [left, op, right], rangeFrom(p, left));
    }

    // Concatenation
    case TokenType.Concatenation: {
      const op = p.advance();
      const right = parseExpression(p, prec);
      return makeNode("BinaryExpression", [left, op, right], rangeFrom(p, left));
    }

    // Arithmetic
    case TokenType.Plus:
    case TokenType.Minus:
    case TokenType.Asterisk:
    case TokenType.Slash:
    case TokenType.MOD:
    case TokenType.DoubleAsterisk: {
      const op = p.advance();
      const right = parseExpression(p, prec);
      return makeNode("BinaryExpression", [left, op, right], rangeFrom(p, left));
    }

    // IS [NOT] NULL / NAN / INFINITE / EMPTY / JSON / OF / A SET
    case TokenType.IS: {
      const is = p.advance();
      const children: (SyntaxNode | Token)[] = [left, is];
      const notKw = p.match(TokenType.NOT);
      if (notKw) children.push(notKw);

      // Consume the predicate: NULL, NAN, INFINITE, EMPTY, JSON, A SET, OF (type)
      if (p.checkKeyword(TokenType.NULL_, TokenType.NAN_, TokenType.INFINITE, TokenType.EMPTY_,
                          TokenType.JSON, TokenType.DANGLING)) {
        children.push(p.advance());
      } else if (p.check(TokenType.A_LETTER)) {
        children.push(p.advance()); // A
        children.push(p.expect(TokenType.SET)); // SET
      } else if (p.check(TokenType.OF)) {
        children.push(p.advance()); // OF
        if (p.check(TokenType.LeftParen)) {
          children.push(p.parseParenthesized(() => p.parseCommaSeparated(() => p.parseDataType())));
        }
      } else {
        children.push(p.advance()); // whatever follows
      }
      return makeNode("IsExpression", children, rangeFrom(p, left));
    }

    // [NOT] IN
    case TokenType.IN:
    case TokenType.NOT: {
      const children: (SyntaxNode | Token)[] = [left];
      if (tok.type === TokenType.NOT) {
        children.push(p.advance()); // NOT
      }

      const nextType = p.peek().type;

      if (nextType === TokenType.IN) {
        children.push(p.advance()); // IN
        if (p.check(TokenType.LeftParen)) {
          children.push(p.parseParenthesized(() => {
            if (p.check(TokenType.SELECT) || p.check(TokenType.WITH)) {
              const { parseSelect } = require("./dml.js");
              return [parseSelect(p)];
            }
            return [parseExpressionList(p)];
          }));
        } else {
          children.push(parseExpression(p, Prec.Comparison));
        }
        return makeNode("InExpression", children, rangeFrom(p, left));
      }

      if (nextType === TokenType.BETWEEN) {
        children.push(p.advance()); // BETWEEN
        children.push(parseExpression(p, Prec.Relational));
        children.push(p.expect(TokenType.AND));
        children.push(parseExpression(p, Prec.Relational));
        return makeNode("BetweenExpression", children, rangeFrom(p, left));
      }

      if (nextType === TokenType.LIKE || nextType === TokenType.LIKEC) {
        children.push(p.advance()); // LIKE
        children.push(parseExpression(p, Prec.Relational));
        if (p.match(TokenType.ESCAPE)) {
          children.push(p.tokens[p.pos - 1]);
          children.push(parseExpression(p, Prec.Relational));
        }
        return makeNode("LikeExpression", children, rangeFrom(p, left));
      }

      if (nextType === TokenType.MEMBER) {
        children.push(p.advance()); // MEMBER
        if (p.match(TokenType.OF)) children.push(p.tokens[p.pos - 1]);
        children.push(parseExpression(p, Prec.Comparison));
        return makeNode("MemberOfExpression", children, rangeFrom(p, left));
      }

      if (nextType === TokenType.SUBMULTISET) {
        children.push(p.advance()); // SUBMULTISET
        if (p.match(TokenType.OF)) children.push(p.tokens[p.pos - 1]);
        children.push(parseExpression(p, Prec.Comparison));
        return makeNode("SubmultisetExpression", children, rangeFrom(p, left));
      }

      // Standalone NOT shouldn't get here (handled in prefix), but recover
      return makeNode("UnknownExpression", children, rangeFrom(p, left));
    }

    // IN/BETWEEN/LIKE without NOT prefix
    case TokenType.BETWEEN: {
      const children: (SyntaxNode | Token)[] = [left];
      children.push(p.advance()); // BETWEEN
      children.push(parseExpression(p, Prec.Relational));
      children.push(p.expect(TokenType.AND));
      children.push(parseExpression(p, Prec.Relational));
      return makeNode("BetweenExpression", children, rangeFrom(p, left));
    }

    case TokenType.LIKE:
    case TokenType.LIKEC: {
      const children: (SyntaxNode | Token)[] = [left];
      children.push(p.advance()); // LIKE
      children.push(parseExpression(p, Prec.Relational));
      if (p.match(TokenType.ESCAPE)) {
        children.push(p.tokens[p.pos - 1]);
        children.push(parseExpression(p, Prec.Relational));
      }
      return makeNode("LikeExpression", children, rangeFrom(p, left));
    }

    case TokenType.MEMBER: {
      const children: (SyntaxNode | Token)[] = [left];
      children.push(p.advance()); // MEMBER
      if (p.match(TokenType.OF)) children.push(p.tokens[p.pos - 1]);
      children.push(parseExpression(p, Prec.Comparison));
      return makeNode("MemberOfExpression", children, rangeFrom(p, left));
    }

    case TokenType.SUBMULTISET: {
      const children: (SyntaxNode | Token)[] = [left];
      children.push(p.advance()); // SUBMULTISET
      if (p.match(TokenType.OF)) children.push(p.tokens[p.pos - 1]);
      children.push(parseExpression(p, Prec.Comparison));
      return makeNode("SubmultisetExpression", children, rangeFrom(p, left));
    }

    // Dot access (member access, schema.table.column)
    case TokenType.Dot: {
      const dot = p.advance();
      const member = p.advance(); // identifier or keyword or *
      if (member.type === TokenType.Asterisk) {
        return makeNode("DotStar", [left, dot, member], rangeFrom(p, left));
      }
      const node = makeNode("DotAccess", [left, dot, member], rangeFrom(p, left));
      return node;
    }

    // Percent access (%TYPE, %ROWTYPE, %FOUND, %NOTFOUND, %ISOPEN, %ROWCOUNT, %BULK_ROWCOUNT, %BULK_EXCEPTIONS)
    case TokenType.Percent: {
      const pct = p.advance();
      const attr = p.advance();
      return makeNode("PercentAccess", [left, pct, attr], rangeFrom(p, left));
    }

    // Function call / subscript
    case TokenType.LeftParen: {
      const paren = p.parseParenthesized(() => {
        if (p.check(TokenType.RightParen)) return [];
        return p.parseCommaSeparated(() => parseFunctionArg(p));
      });
      let call: SyntaxNode = makeNode("FunctionCall", [left, paren], rangeFrom(p, left));

      // Analytic/window function: func(...) OVER (...)
      if (p.check(TokenType.OVER)) {
        call = parseWindowClause(p, call);
      }

      return call;
    }
  }

  // Should not reach here
  return left;
}

function parseFunctionArg(p: Parser): SyntaxNode {
  const start = p.peek();

  // Named argument: name => value
  if ((p.peek().type === TokenType.Identifier || isKeywordToken(p.peek().type)) &&
      p.peek(1).type === TokenType.Arrow) {
    const name = p.advance();
    const arrow = p.advance();
    const value = parseExpression(p);
    return makeNode("NamedArgument", [name, arrow, value], p.makeRange(start));
  }

  return parseExpression(p);
}

function parseCaseExpression(p: Parser): SyntaxNode {
  const kw = p.advance(); // CASE
  const children: (SyntaxNode | Token)[] = [kw];

  // Simple CASE: CASE expr WHEN ...
  // Searched CASE: CASE WHEN ...
  if (!p.check(TokenType.WHEN) && !p.check(TokenType.END)) {
    children.push(parseExpression(p));
  }

  while (p.match(TokenType.WHEN)) {
    const whenChildren: (SyntaxNode | Token)[] = [p.tokens[p.pos - 1]];
    whenChildren.push(parseExpression(p));
    whenChildren.push(p.expect(TokenType.THEN));
    whenChildren.push(parseExpression(p));
    children.push(makeNode("WhenClause", whenChildren, p.makeRange(p.tokens[p.pos - 1])));
  }

  if (p.match(TokenType.ELSE)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseExpression(p));
  }

  children.push(p.expect(TokenType.END));
  return makeNode("CaseExpression", children, p.makeRange(kw));
}

function isKeywordToken(type: TokenType): boolean {
  // All keyword enum values are uppercase strings matching keyword names
  // Non-keyword tokens are mixed case (e.g., "Identifier", "LeftParen")
  // Keywords are things like "SELECT", "FROM", etc.
  return typeof type === "string" &&
    type === type.toUpperCase() &&
    type.length > 1 &&
    type !== "EOF" &&
    !type.startsWith("Left") &&
    !type.startsWith("Right") &&
    type !== "Error";
}

function parseWindowClause(p: Parser, funcCall: SyntaxNode): SyntaxNode {
  const overKw = p.advance(); // OVER
  const children: (SyntaxNode | Token)[] = [funcCall, overKw];

  // OVER ( window_specification ) or OVER window_name
  if (p.check(TokenType.LeftParen)) {
    const paren = p.parseParenthesized(() => {
      const inner: (SyntaxNode | Token)[] = [];

      // PARTITION BY
      if (p.check(TokenType.PARTITION)) {
        inner.push(p.advance()); // PARTITION
        inner.push(p.expect(TokenType.BY));
        inner.push(parseExpressionList(p));
      }

      // ORDER BY
      if (p.check(TokenType.ORDER)) {
        inner.push(p.advance()); // ORDER
        inner.push(p.expect(TokenType.BY));
        inner.push(parseExpressionList(p));
      }

      // Windowing clause: ROWS | RANGE | GROUPS
      if (p.checkKeyword(TokenType.ROWS, TokenType.RANGE, TokenType.GROUPS)) {
        inner.push(p.advance()); // ROWS/RANGE/GROUPS
        inner.push(...parseWindowFrame(p));
      }

      return inner;
    });
    children.push(paren);
  } else {
    // OVER window_name
    children.push(p.advance());
  }

  return makeNode("WindowFunction", children, rangeFrom(p, funcCall));
}

function parseWindowFrame(p: Parser): (SyntaxNode | Token)[] {
  const children: (SyntaxNode | Token)[] = [];

  if (p.check(TokenType.BETWEEN)) {
    // BETWEEN bound AND bound
    children.push(p.advance()); // BETWEEN
    children.push(...parseWindowBound(p));
    children.push(p.expect(TokenType.AND));
    children.push(...parseWindowBound(p));
  } else {
    // Single bound
    children.push(...parseWindowBound(p));
  }

  return children;
}

function parseWindowBound(p: Parser): (SyntaxNode | Token)[] {
  const children: (SyntaxNode | Token)[] = [];

  if (p.check(TokenType.UNBOUNDED)) {
    children.push(p.advance()); // UNBOUNDED
    children.push(p.advance()); // PRECEDING or FOLLOWING
  } else if (p.check(TokenType.CURRENT)) {
    children.push(p.advance()); // CURRENT
    children.push(p.advance()); // ROW
  } else {
    // expr PRECEDING/FOLLOWING
    children.push(parseExpression(p, Prec.Comparison));
    children.push(p.advance()); // PRECEDING or FOLLOWING
  }

  return children;
}

function rangeFrom(p: Parser, left: SyntaxNode) {
  const start = left.range?.start ?? { offset: 0, line: 0, col: 0 };
  return p.makeRange({ offset: start.offset, line: start.line, col: start.col, type: TokenType.EOF, text: "" });
}
