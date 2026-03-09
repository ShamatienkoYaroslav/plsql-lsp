import { Token, TokenType } from "./tokens.js";
import { SyntaxNode, makeNode } from "./ast.js";
import { Parser } from "./parser.js";
import { parseExpression, parseExpressionList } from "./expressions.js";
import { parseSelect } from "./dml.js";
import { parseProcedureBody, parseFunctionBody, parsePackageSpec, parsePackageBody,
         parseTriggerBody, parseTypeBody } from "./plsql.js";

// ─── CREATE ────────────────────────────────────────────────────────────────

export function parseCreate(p: Parser): SyntaxNode {
  const start = p.advance(); // CREATE
  const children: (SyntaxNode | Token)[] = [start];

  // OR REPLACE
  if (p.check(TokenType.OR) && p.peek(1).type === TokenType.REPLACE) {
    children.push(p.advance()); // OR
    children.push(p.advance()); // REPLACE
  }

  // Optional: EDITIONABLE / NONEDITIONABLE / FORCE / NO FORCE
  while (p.matchKeyword(TokenType.EDITIONABLE, TokenType.NONEDITIONABLE, TokenType.FORCE, TokenType.NO)) {
    children.push(p.tokens[p.pos - 1]);
  }

  // Optional: GLOBAL TEMPORARY / PRIVATE TEMPORARY / SHARDED / DUPLICATED / IMMUTABLE / BLOCKCHAIN
  while (p.matchKeyword(TokenType.GLOBAL, TokenType.PRIVATE, TokenType.SHARDED, TokenType.DUPLICATED,
                          TokenType.IMMUTABLE, TokenType.BLOCKCHAIN, TokenType.TEMPORARY)) {
    children.push(p.tokens[p.pos - 1]);
  }

  // Optional: MATERIALIZED
  if (p.match(TokenType.MATERIALIZED)) {
    children.push(p.tokens[p.pos - 1]);
  }

  // Optional: UNIQUE / BITMAP (for indexes)
  if (p.matchKeyword(TokenType.UNIQUE, TokenType.BITMAP)) {
    children.push(p.tokens[p.pos - 1]);
  }

  // Dispatch on object type
  const objType = p.peek().type;

  switch (objType) {
    case TokenType.TABLE:
      return parseCreateTable(p, children);
    case TokenType.VIEW:
      return parseCreateView(p, children);
    case TokenType.INDEX:
      return parseCreateIndex(p, children);
    case TokenType.SEQUENCE:
      return parseCreateSequence(p, children);
    case TokenType.SYNONYM:
      return parseCreateSynonym(p, children);
    case TokenType.DATABASE:
      if (p.peek(1).type === TokenType.LINK) {
        return parseCreateDatabaseLink(p, children);
      }
      return parseGenericCreate(p, children);
    case TokenType.DIRECTORY:
      return parseCreateDirectory(p, children);
    case TokenType.TYPE:
      return parseCreateType(p, children);
    case TokenType.TRIGGER:
      return parseCreateTrigger(p, children);
    case TokenType.PROCEDURE:
      return parseCreateProcedure(p, children);
    case TokenType.FUNCTION:
      return parseCreateFunction(p, children);
    case TokenType.PACKAGE:
      return parseCreatePackage(p, children);
    case TokenType.BODY:
      // This handles: CREATE ... PACKAGE BODY (already consumed PACKAGE)
      // Shouldn't normally get here
      return parseGenericCreate(p, children);
    default:
      return parseGenericCreate(p, children);
  }
}

function parseCreateTable(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  children.push(p.advance()); // TABLE

  // IF NOT EXISTS
  if (p.check(TokenType.IF) && p.peek(1).type === TokenType.NOT) {
    children.push(p.advance()); // IF
    children.push(p.advance()); // NOT
    children.push(p.expect(TokenType.EXISTS));
  }

  children.push(p.parseQualifiedName());

  // Column definitions
  if (p.check(TokenType.LeftParen)) {
    children.push(p.parseParenthesized(() =>
      p.parseCommaSeparated(() => parseColumnDefOrConstraint(p))
    ));
  }

  // AS subquery
  if (p.matchKeyword(TokenType.AS)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(parseSelect(p));
    return makeNode("CreateTableAsSelect", children, p.makeRange(children[0] as Token));
  }

  // Storage/partition/etc clauses — consume generically until ; or /
  parseTableOptions(p, children);

  return makeNode("CreateTable", children, p.makeRange(children[0] as Token));
}

function parseColumnDefOrConstraint(p: Parser): SyntaxNode {
  const start = p.peek();

  // Out-of-line constraint
  if (p.check(TokenType.CONSTRAINT) || p.check(TokenType.PRIMARY) ||
      p.check(TokenType.UNIQUE) || p.check(TokenType.CHECK) ||
      p.check(TokenType.FOREIGN) || p.check(TokenType.REF)) {
    return parseOutOfLineConstraint(p);
  }

  // Column definition
  return parseColumnDef(p);
}

function parseColumnDef(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];

  children.push(p.parseIdentifier()); // column name
  children.push(p.parseDataType());

  // Inline constraints and column options
  while (!p.isAtEnd() && !p.check(TokenType.Comma) && !p.check(TokenType.RightParen)) {
    if (p.check(TokenType.CONSTRAINT)) {
      children.push(p.advance());
      children.push(p.parseIdentifier());
    }

    if (p.match(TokenType.DEFAULT)) {
      children.push(p.tokens[p.pos - 1]);
      if (p.match(TokenType.ON)) {
        children.push(p.tokens[p.pos - 1]);
        children.push(p.advance()); // NULL
      }
      children.push(parseExpression(p));
      continue;
    }

    if (p.check(TokenType.NOT) && p.peek(1).type === TokenType.NULL_) {
      children.push(p.advance());
      children.push(p.advance());
      continue;
    }
    if (p.match(TokenType.NULL_)) { children.push(p.tokens[p.pos - 1]); continue; }
    if (p.match(TokenType.PRIMARY)) {
      children.push(p.tokens[p.pos - 1]);
      children.push(p.expect(TokenType.KEY));
      continue;
    }
    if (p.match(TokenType.UNIQUE)) { children.push(p.tokens[p.pos - 1]); continue; }
    if (p.match(TokenType.CHECK)) {
      children.push(p.tokens[p.pos - 1]);
      children.push(p.parseParenthesized(() => [parseExpression(p)]));
      continue;
    }
    if (p.match(TokenType.REFERENCES)) {
      children.push(p.tokens[p.pos - 1]);
      children.push(p.parseQualifiedName());
      if (p.check(TokenType.LeftParen)) {
        children.push(p.parseParenthesized(() => p.parseCommaSeparated(() => p.parseIdentifier())));
      }
      // ON DELETE CASCADE / SET NULL
      if (p.check(TokenType.ON) && p.peek(1).type === TokenType.DELETE) {
        children.push(p.advance());
        children.push(p.advance());
        children.push(p.advance()); // CASCADE or SET
        if (p.check(TokenType.NULL_)) children.push(p.advance());
      }
      continue;
    }

    // GENERATED ALWAYS/BY DEFAULT AS IDENTITY
    if (p.match(TokenType.GENERATED)) {
      children.push(p.tokens[p.pos - 1]);
      while (!p.isAtEnd() && !p.check(TokenType.Comma) && !p.check(TokenType.RightParen) &&
             !p.check(TokenType.CONSTRAINT) && !p.check(TokenType.NOT) && !p.check(TokenType.NULL_) &&
             !p.check(TokenType.PRIMARY) && !p.check(TokenType.UNIQUE) && !p.check(TokenType.CHECK) &&
             !p.check(TokenType.REFERENCES)) {
        children.push(p.advance());
      }
      continue;
    }

    // INVISIBLE / VISIBLE
    if (p.matchKeyword(TokenType.INVISIBLE, TokenType.VISIBLE)) {
      children.push(p.tokens[p.pos - 1]);
      continue;
    }

    // VIRTUAL / COLLATE
    if (p.matchKeyword(TokenType.VIRTUAL, TokenType.COLLATE)) {
      children.push(p.tokens[p.pos - 1]);
      if (p.tokens[p.pos - 1].type === TokenType.COLLATE) {
        children.push(p.parseIdentifier());
      }
      continue;
    }

    // ANNOTATIONS
    if (p.match(TokenType.ANNOTATIONS)) {
      children.push(p.tokens[p.pos - 1]);
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
      continue;
    }

    // ENABLE/DISABLE, VALIDATE/NOVALIDATE, RELY/NORELY
    if (p.matchKeyword(TokenType.ENABLE, TokenType.DISABLE, TokenType.VALIDATE, TokenType.NOVALIDATE,
                        TokenType.RELY, TokenType.NORELY)) {
      children.push(p.tokens[p.pos - 1]);
      continue;
    }

    break;
  }

  return makeNode("ColumnDef", children, p.makeRange(start));
}

function parseOutOfLineConstraint(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];

  if (p.match(TokenType.CONSTRAINT)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.parseIdentifier());
  }

  if (p.match(TokenType.PRIMARY)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.expect(TokenType.KEY));
    children.push(p.parseParenthesized(() => p.parseCommaSeparated(() => p.parseIdentifier())));
  } else if (p.match(TokenType.UNIQUE)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.parseParenthesized(() => p.parseCommaSeparated(() => p.parseIdentifier())));
  } else if (p.match(TokenType.FOREIGN)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.expect(TokenType.KEY));
    children.push(p.parseParenthesized(() => p.parseCommaSeparated(() => p.parseIdentifier())));
    children.push(p.expect(TokenType.REFERENCES));
    children.push(p.parseQualifiedName());
    if (p.check(TokenType.LeftParen)) {
      children.push(p.parseParenthesized(() => p.parseCommaSeparated(() => p.parseIdentifier())));
    }
    if (p.check(TokenType.ON) && p.peek(1).type === TokenType.DELETE) {
      children.push(p.advance());
      children.push(p.advance());
      children.push(p.advance());
      if (p.check(TokenType.NULL_)) children.push(p.advance());
    }
  } else if (p.match(TokenType.CHECK)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.parseParenthesized(() => [parseExpression(p)]));
  }

  // Constraint state: ENABLE/DISABLE, VALIDATE/NOVALIDATE, DEFERRABLE, INITIALLY DEFERRED/IMMEDIATE
  while (p.matchKeyword(TokenType.ENABLE, TokenType.DISABLE, TokenType.VALIDATE, TokenType.NOVALIDATE,
                          TokenType.DEFERRABLE, TokenType.NOT, TokenType.INITIALLY, TokenType.RELY, TokenType.NORELY)) {
    children.push(p.tokens[p.pos - 1]);
    if (p.tokens[p.pos - 1].type === TokenType.NOT) {
      children.push(p.expect(TokenType.DEFERRABLE));
    }
    if (p.tokens[p.pos - 1].type === TokenType.INITIALLY) {
      if (p.matchKeyword(TokenType.DEFERRED, TokenType.IMMEDIATE)) {
        children.push(p.tokens[p.pos - 1]);
      }
    }
  }

  return makeNode("OutOfLineConstraint", children, p.makeRange(start));
}

function parseTableOptions(p: Parser, children: (SyntaxNode | Token)[]): void {
  // Consume various table-level clauses until we hit ; or EOF
  while (!p.isAtEnd() && !p.check(TokenType.Semicolon) && !p.check(TokenType.Slash)) {
    // Known table clauses
    if (p.checkKeyword(TokenType.ORGANIZATION, TokenType.TABLESPACE, TokenType.STORAGE,
                        TokenType.PCTFREE, TokenType.PCTUSED, TokenType.INITRANS, TokenType.MAXTRANS,
                        TokenType.LOGGING, TokenType.NOLOGGING, TokenType.NOCOMPRESS, TokenType.COMPRESS,
                        TokenType.PARALLEL, TokenType.NOPARALLEL, TokenType.CACHE, TokenType.NOCACHE,
                        TokenType.MONITORING, TokenType.NOMONITORING, TokenType.ENABLE, TokenType.DISABLE,
                        TokenType.ROW, TokenType.PARTITION, TokenType.LOB, TokenType.OVERFLOW_)) {
      children.push(p.advance());
      // Some clauses have sub-clauses — consume carefully
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
      continue;
    }

    // Check if we hit something that looks like a new statement
    if (p.checkKeyword(TokenType.CREATE, TokenType.ALTER, TokenType.DROP, TokenType.SELECT,
                        TokenType.INSERT, TokenType.UPDATE, TokenType.DELETE, TokenType.GRANT,
                        TokenType.REVOKE, TokenType.BEGIN, TokenType.DECLARE)) {
      break;
    }

    children.push(p.advance());
  }
}

function parseCreateView(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  children.push(p.advance()); // VIEW

  children.push(p.parseQualifiedName());

  // Optional column list
  if (p.check(TokenType.LeftParen)) {
    children.push(p.parseParenthesized(() =>
      p.parseCommaSeparated(() => {
        const start = p.peek();
        const parts: (SyntaxNode | Token)[] = [p.parseIdentifier()];
        // Optional constraints on view columns
        while (p.matchKeyword(TokenType.CONSTRAINT, TokenType.PRIMARY, TokenType.UNIQUE,
                              TokenType.NOT, TokenType.NULL_, TokenType.VISIBLE, TokenType.INVISIBLE)) {
          parts.push(p.tokens[p.pos - 1]);
        }
        return makeNode("ViewColumn", parts, p.makeRange(start));
      })
    ));
  }

  children.push(p.expect(TokenType.AS));
  children.push(parseSelect(p));

  // WITH CHECK OPTION / WITH READ ONLY
  if (p.match(TokenType.WITH)) {
    children.push(p.tokens[p.pos - 1]);
    if (p.match(TokenType.CHECK)) {
      children.push(p.tokens[p.pos - 1]);
      children.push(p.expect(TokenType.OPTION));
    } else if (p.match(TokenType.READ)) {
      children.push(p.tokens[p.pos - 1]);
      children.push(p.expect(TokenType.ONLY));
    }
  }

  return makeNode("CreateView", children, p.makeRange(children[0] as Token));
}

function parseCreateIndex(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  children.push(p.advance()); // INDEX

  // IF NOT EXISTS
  if (p.check(TokenType.IF) && p.peek(1).type === TokenType.NOT) {
    children.push(p.advance());
    children.push(p.advance());
    children.push(p.expect(TokenType.EXISTS));
  }

  children.push(p.parseQualifiedName());

  children.push(p.expect(TokenType.ON));
  children.push(p.parseQualifiedName());

  if (p.check(TokenType.LeftParen)) {
    children.push(p.parseParenthesized(() =>
      p.parseCommaSeparated(() => {
        const expr = parseExpression(p);
        const parts: (SyntaxNode | Token)[] = [expr];
        if (p.matchKeyword(TokenType.ASC, TokenType.DESC)) parts.push(p.tokens[p.pos - 1]);
        return makeNode("IndexColumn", parts, p.makeRange(p.peek()));
      })
    ));
  }

  // Index options
  parseTableOptions(p, children);

  return makeNode("CreateIndex", children, p.makeRange(children[0] as Token));
}

function parseCreateSequence(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  children.push(p.advance()); // SEQUENCE
  children.push(p.parseQualifiedName());

  // Sequence options
  while (!p.isAtEnd() && !p.check(TokenType.Semicolon)) {
    if (p.matchKeyword(TokenType.INCREMENT, TokenType.START, TokenType.MAXVALUE, TokenType.NOMAXVALUE,
                        TokenType.MINVALUE, TokenType.NOMINVALUE, TokenType.CYCLE, TokenType.NOCYCLE,
                        TokenType.CACHE, TokenType.NOCACHE, TokenType.ORDER, TokenType.NOORDER,
                        TokenType.KEEP, TokenType.NOKEEP, TokenType.SCALE, TokenType.NOSCALE,
                        TokenType.SESSION, TokenType.GLOBAL, TokenType.SHARING)) {
      children.push(p.tokens[p.pos - 1]);
      if (p.tokens[p.pos - 1].type === TokenType.INCREMENT) {
        children.push(p.expect(TokenType.BY));
        children.push(parseExpression(p));
      } else if (p.tokens[p.pos - 1].type === TokenType.START) {
        children.push(p.expect(TokenType.WITH));
        children.push(parseExpression(p));
      } else if (p.tokens[p.pos - 1].type === TokenType.MAXVALUE ||
                 p.tokens[p.pos - 1].type === TokenType.MINVALUE ||
                 p.tokens[p.pos - 1].type === TokenType.CACHE) {
        if (!p.check(TokenType.Semicolon) && !p.isAtEnd()) {
          children.push(parseExpression(p));
        }
      }
      continue;
    }
    break;
  }

  return makeNode("CreateSequence", children, p.makeRange(children[0] as Token));
}

function parseCreateSynonym(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  // PUBLIC already consumed as part of CREATE [PUBLIC]
  children.push(p.advance()); // SYNONYM
  children.push(p.parseQualifiedName());
  children.push(p.expect(TokenType.FOR));
  children.push(p.parseQualifiedName());
  // @dblink
  if (p.match(TokenType.AtSign)) {
    children.push(p.tokens[p.pos - 1]);
    children.push(p.parseIdentifier());
  }
  return makeNode("CreateSynonym", children, p.makeRange(children[0] as Token));
}

function parseCreateDatabaseLink(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  children.push(p.advance()); // DATABASE
  children.push(p.advance()); // LINK
  children.push(p.parseQualifiedName());

  // CONNECT TO ... IDENTIFIED BY ... USING '...'
  while (!p.isAtEnd() && !p.check(TokenType.Semicolon)) {
    children.push(p.advance());
  }

  return makeNode("CreateDatabaseLink", children, p.makeRange(children[0] as Token));
}

function parseCreateDirectory(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  children.push(p.advance()); // DIRECTORY
  children.push(p.parseQualifiedName());
  children.push(p.expect(TokenType.AS));
  children.push(parseExpression(p)); // string literal path
  return makeNode("CreateDirectory", children, p.makeRange(children[0] as Token));
}

function parseCreateType(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  children.push(p.advance()); // TYPE

  // TYPE BODY
  if (p.check(TokenType.BODY)) {
    children.push(p.advance());
    return parseTypeBody(p, children);
  }

  children.push(p.parseQualifiedName());

  // Could be: IS/AS OBJECT/TABLE OF/VARRAY, or just forward declaration (;)
  if (p.check(TokenType.Semicolon)) {
    return makeNode("CreateType", children, p.makeRange(children[0] as Token));
  }

  // FORCE / UNDER
  while (p.matchKeyword(TokenType.FORCE, TokenType.UNDER, TokenType.AUTHID, TokenType.ACCESSIBLE)) {
    children.push(p.tokens[p.pos - 1]);
    if (p.tokens[p.pos - 1].type === TokenType.UNDER) {
      children.push(p.parseQualifiedName());
    }
    if (p.tokens[p.pos - 1].type === TokenType.AUTHID) {
      children.push(p.advance()); // CURRENT_USER or DEFINER
    }
  }

  if (p.matchKeyword(TokenType.IS, TokenType.AS)) {
    children.push(p.tokens[p.pos - 1]);
  }

  // OBJECT, TABLE OF, VARRAY
  if (p.match(TokenType.OBJECT)) {
    children.push(p.tokens[p.pos - 1]);
    if (p.check(TokenType.LeftParen)) {
      children.push(p.parseParenthesized(() =>
        p.parseCommaSeparated(() => {
          // Member/static method or attribute
          const start = p.peek();
          const parts: (SyntaxNode | Token)[] = [];
          while (!p.isAtEnd() && !p.check(TokenType.Comma) && !p.check(TokenType.RightParen)) {
            parts.push(p.advance());
          }
          return makeNode("TypeMember", parts, p.makeRange(start));
        })
      ));
    }
  } else if (p.check(TokenType.TABLE)) {
    children.push(p.advance());
    children.push(p.expect(TokenType.OF));
    children.push(p.parseDataType());
  } else if (p.checkKeyword(TokenType.VARRAY, TokenType.VARYING)) {
    children.push(p.advance());
    if (p.check(TokenType.LeftParen)) {
      children.push(p.parseParenthesized(() => [parseExpression(p)]));
    }
    children.push(p.expect(TokenType.OF));
    children.push(p.parseDataType());
  } else {
    // Other type definitions — consume generically
    while (!p.isAtEnd() && !p.check(TokenType.Semicolon) && !p.check(TokenType.Slash)) {
      children.push(p.advance());
    }
  }

  // Optional NOT FINAL / NOT INSTANTIABLE / FINAL / INSTANTIABLE
  while (p.matchKeyword(TokenType.NOT, TokenType.FINAL, TokenType.INSTANTIABLE)) {
    children.push(p.tokens[p.pos - 1]);
  }

  return makeNode("CreateType", children, p.makeRange(children[0] as Token));
}

function parseCreateTrigger(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  children.push(p.advance()); // TRIGGER
  return parseTriggerBody(p, children);
}

function parseCreateProcedure(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  children.push(p.advance()); // PROCEDURE
  return parseProcedureBody(p, children);
}

function parseCreateFunction(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  children.push(p.advance()); // FUNCTION
  return parseFunctionBody(p, children);
}

function parseCreatePackage(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  children.push(p.advance()); // PACKAGE

  if (p.check(TokenType.BODY)) {
    children.push(p.advance()); // BODY
    return parsePackageBody(p, children);
  }

  return parsePackageSpec(p, children);
}

function parseGenericCreate(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  // Consume everything until ; or /
  while (!p.isAtEnd() && !p.check(TokenType.Semicolon) && !p.check(TokenType.Slash)) {
    // Watch for nested BEGIN/END blocks
    if (p.check(TokenType.BEGIN)) {
      // Parse the block properly
      const { parseAnonymousBlock } = require("./plsql.js");
      children.push(parseAnonymousBlock(p));
      continue;
    }
    children.push(p.advance());
  }
  return makeNode("CreateStatement", children, p.makeRange(children[0] as Token));
}

// ─── ALTER ─────────────────────────────────────────────────────────────────

export function parseAlter(p: Parser): SyntaxNode {
  const start = p.advance(); // ALTER
  const children: (SyntaxNode | Token)[] = [start];

  const objType = p.peek().type;

  switch (objType) {
    case TokenType.TABLE:
      return parseAlterTable(p, children);
    case TokenType.INDEX:
    case TokenType.SEQUENCE:
    case TokenType.VIEW:
    case TokenType.TRIGGER:
    case TokenType.PROCEDURE:
    case TokenType.FUNCTION:
    case TokenType.PACKAGE:
    case TokenType.TYPE:
    case TokenType.SESSION:
    case TokenType.SYSTEM:
    case TokenType.USER:
    case TokenType.ROLE:
    case TokenType.PROFILE:
    case TokenType.TABLESPACE:
    case TokenType.DATABASE:
      return parseGenericAlter(p, children);
    default:
      return parseGenericAlter(p, children);
  }
}

function parseAlterTable(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  children.push(p.advance()); // TABLE
  children.push(p.parseQualifiedName());

  // ALTER TABLE actions — consume generically
  while (!p.isAtEnd() && !p.check(TokenType.Semicolon)) {
    if (p.checkKeyword(TokenType.CREATE, TokenType.ALTER, TokenType.DROP, TokenType.SELECT,
                        TokenType.INSERT, TokenType.UPDATE, TokenType.DELETE, TokenType.BEGIN,
                        TokenType.DECLARE, TokenType.GRANT, TokenType.REVOKE)) {
      break;
    }

    // ADD (column_def | constraint)
    if (p.match(TokenType.ADD)) {
      children.push(p.tokens[p.pos - 1]);
      if (p.check(TokenType.LeftParen)) {
        children.push(p.parseParenthesized(() =>
          p.parseCommaSeparated(() => parseColumnDefOrConstraint(p))
        ));
      } else {
        children.push(parseColumnDefOrConstraint(p));
      }
      continue;
    }

    // MODIFY
    if (p.match(TokenType.MODIFY)) {
      children.push(p.tokens[p.pos - 1]);
      if (p.check(TokenType.LeftParen)) {
        children.push(p.parseParenthesized(() =>
          p.parseCommaSeparated(() => parseColumnDef(p))
        ));
      } else {
        children.push(parseColumnDef(p));
      }
      continue;
    }

    // DROP COLUMN / DROP CONSTRAINT / DROP PRIMARY KEY / DROP UNIQUE
    if (p.check(TokenType.DROP)) {
      children.push(p.advance());
      if (p.matchKeyword(TokenType.COLUMN)) {
        children.push(p.tokens[p.pos - 1]);
        children.push(p.parseIdentifier());
      } else if (p.match(TokenType.CONSTRAINT)) {
        children.push(p.tokens[p.pos - 1]);
        children.push(p.parseIdentifier());
      } else if (p.match(TokenType.PRIMARY)) {
        children.push(p.tokens[p.pos - 1]);
        children.push(p.expect(TokenType.KEY));
      } else if (p.match(TokenType.UNIQUE)) {
        children.push(p.tokens[p.pos - 1]);
        if (p.check(TokenType.LeftParen)) {
          children.push(p.parseParenthesized(() => p.parseCommaSeparated(() => p.parseIdentifier())));
        }
      }
      continue;
    }

    // RENAME COLUMN / RENAME TO / RENAME CONSTRAINT
    if (p.match(TokenType.RENAME)) {
      children.push(p.tokens[p.pos - 1]);
      if (p.match(TokenType.COLUMN)) children.push(p.tokens[p.pos - 1]);
      if (p.match(TokenType.CONSTRAINT)) children.push(p.tokens[p.pos - 1]);
      children.push(p.parseIdentifier());
      children.push(p.expect(TokenType.TO));
      children.push(p.parseIdentifier());
      continue;
    }

    // ENABLE / DISABLE
    if (p.matchKeyword(TokenType.ENABLE, TokenType.DISABLE)) {
      children.push(p.tokens[p.pos - 1]);
      continue;
    }

    children.push(p.advance());
  }

  return makeNode("AlterTable", children, p.makeRange(children[0] as Token));
}

function parseGenericAlter(p: Parser, children: (SyntaxNode | Token)[]): SyntaxNode {
  while (!p.isAtEnd() && !p.check(TokenType.Semicolon)) {
    if (p.checkKeyword(TokenType.CREATE, TokenType.ALTER, TokenType.DROP, TokenType.SELECT,
                        TokenType.INSERT, TokenType.UPDATE, TokenType.DELETE, TokenType.BEGIN,
                        TokenType.DECLARE, TokenType.GRANT, TokenType.REVOKE)) {
      break;
    }
    children.push(p.advance());
  }
  return makeNode("AlterStatement", children, p.makeRange(children[0] as Token));
}

// ─── DROP ──────────────────────────────────────────────────────────────────

export function parseDrop(p: Parser): SyntaxNode {
  const start = p.advance(); // DROP
  const children: (SyntaxNode | Token)[] = [start];

  // Object type keyword
  if (p.matchKeyword(TokenType.TABLE, TokenType.VIEW, TokenType.INDEX, TokenType.SEQUENCE,
                      TokenType.SYNONYM, TokenType.PROCEDURE, TokenType.FUNCTION,
                      TokenType.PACKAGE, TokenType.TRIGGER, TokenType.TYPE, TokenType.DATABASE,
                      TokenType.DIRECTORY, TokenType.TABLESPACE, TokenType.USER, TokenType.ROLE,
                      TokenType.PROFILE, TokenType.CLUSTER, TokenType.CONTEXT, TokenType.DIMENSION,
                      TokenType.EDITION, TokenType.LIBRARY, TokenType.OPERATOR, TokenType.OUTLINE,
                      TokenType.MATERIALIZED, TokenType.PUBLIC)) {
    children.push(p.tokens[p.pos - 1]);

    // MATERIALIZED VIEW, DATABASE LINK, PUBLIC SYNONYM, PACKAGE BODY, TYPE BODY
    if (p.matchKeyword(TokenType.VIEW, TokenType.LINK, TokenType.SYNONYM, TokenType.BODY)) {
      children.push(p.tokens[p.pos - 1]);
    }
  }

  // IF EXISTS
  if (p.check(TokenType.IF) && p.peek(1).type === TokenType.EXISTS) {
    children.push(p.advance());
    children.push(p.advance());
  }

  // Object name
  if (!p.check(TokenType.Semicolon) && !p.isAtEnd()) {
    children.push(p.parseQualifiedName());
  }

  // CASCADE CONSTRAINTS / PURGE / FORCE
  while (p.matchKeyword(TokenType.CASCADE, TokenType.PURGE, TokenType.FORCE, TokenType.CONSTRAINTS)) {
    children.push(p.tokens[p.pos - 1]);
  }

  return makeNode("DropStatement", children, p.makeRange(start));
}
