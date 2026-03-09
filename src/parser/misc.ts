import { Token, TokenType } from "./tokens.js";
import { SyntaxNode, makeNode } from "./ast.js";
import { Parser } from "./parser.js";
import { parseExpression } from "./expressions.js";

// ─── GRANT ─────────────────────────────────────────────────────────────────

export function parseGrant(p: Parser): SyntaxNode {
  const start = p.advance(); // GRANT
  const children: (SyntaxNode | Token)[] = [start];

  // Consume until ; — GRANT has many forms
  while (!p.isAtEnd() && !p.check(TokenType.Semicolon)) {
    children.push(p.advance());
  }

  return makeNode("GrantStatement", children, p.makeRange(start));
}

// ─── REVOKE ────────────────────────────────────────────────────────────────

export function parseRevoke(p: Parser): SyntaxNode {
  const start = p.advance(); // REVOKE
  const children: (SyntaxNode | Token)[] = [start];

  while (!p.isAtEnd() && !p.check(TokenType.Semicolon)) {
    children.push(p.advance());
  }

  return makeNode("RevokeStatement", children, p.makeRange(start));
}

// ─── COMMENT ON ────────────────────────────────────────────────────────────

export function parseComment(p: Parser): SyntaxNode {
  const start = p.advance(); // COMMENT
  const children: (SyntaxNode | Token)[] = [start];

  children.push(p.expect(TokenType.ON));

  // TABLE/COLUMN/OPERATOR/INDEXTYPE/MATERIALIZED VIEW/MINING MODEL/EDITION
  if (p.matchKeyword(TokenType.TABLE, TokenType.COLUMN, TokenType.OPERATOR, TokenType.INDEXTYPE,
                      TokenType.MATERIALIZED, TokenType.MINING, TokenType.EDITION)) {
    children.push(p.tokens[p.pos - 1]);
    // MATERIALIZED VIEW
    if (p.tokens[p.pos - 1].type === TokenType.MATERIALIZED) {
      children.push(p.expect(TokenType.VIEW));
    }
    if (p.tokens[p.pos - 1].type === TokenType.MINING) {
      children.push(p.expect(TokenType.MODEL));
    }
  }

  // Object name
  children.push(p.parseQualifiedName());

  // IS 'comment text'
  children.push(p.expect(TokenType.IS));
  children.push(parseExpression(p)); // string literal

  return makeNode("CommentStatement", children, p.makeRange(start));
}

// ─── ANALYZE ───────────────────────────────────────────────────────────────

export function parseAnalyze(p: Parser): SyntaxNode {
  const start = p.advance(); // ANALYZE
  const children: (SyntaxNode | Token)[] = [start];

  while (!p.isAtEnd() && !p.check(TokenType.Semicolon)) {
    children.push(p.advance());
  }

  return makeNode("AnalyzeStatement", children, p.makeRange(start));
}

// ─── Transaction Control ──────────────────────────────────────────────────

export function parseTransactionControl(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];

  switch (start.type) {
    case TokenType.COMMIT: {
      children.push(p.advance());
      // COMMIT [WORK] [COMMENT '...'] [WRITE ...]
      if (p.match(TokenType.WORK)) children.push(p.tokens[p.pos - 1]);
      if (p.match(TokenType.COMMENT)) {
        children.push(p.tokens[p.pos - 1]);
        children.push(parseExpression(p));
      }
      if (p.match(TokenType.WRITE)) {
        children.push(p.tokens[p.pos - 1]);
        if (p.matchKeyword(TokenType.IMMEDIATE, TokenType.BATCH)) {
          children.push(p.tokens[p.pos - 1]);
        }
        if (p.matchKeyword(TokenType.WAIT, TokenType.NOWAIT)) {
          children.push(p.tokens[p.pos - 1]);
        }
      }
      if (p.match(TokenType.FORCE)) {
        children.push(p.tokens[p.pos - 1]);
        children.push(parseExpression(p));
      }
      return makeNode("CommitStatement", children, p.makeRange(start));
    }

    case TokenType.ROLLBACK: {
      children.push(p.advance());
      if (p.match(TokenType.WORK)) children.push(p.tokens[p.pos - 1]);
      if (p.match(TokenType.TO)) {
        children.push(p.tokens[p.pos - 1]);
        if (p.match(TokenType.SAVEPOINT)) children.push(p.tokens[p.pos - 1]);
        children.push(p.parseIdentifier());
      }
      if (p.match(TokenType.FORCE)) {
        children.push(p.tokens[p.pos - 1]);
        children.push(parseExpression(p));
      }
      return makeNode("RollbackStatement", children, p.makeRange(start));
    }

    case TokenType.SAVEPOINT: {
      children.push(p.advance());
      children.push(p.parseIdentifier());
      return makeNode("SavepointStatement", children, p.makeRange(start));
    }

    case TokenType.SET: {
      children.push(p.advance()); // SET
      if (p.check(TokenType.TRANSACTION)) {
        children.push(p.advance()); // TRANSACTION
        // READ ONLY / READ WRITE / ISOLATION LEVEL ... / USE ROLLBACK SEGMENT ...
        while (!p.isAtEnd() && !p.check(TokenType.Semicolon)) {
          children.push(p.advance());
        }
        return makeNode("SetTransactionStatement", children, p.makeRange(start));
      }
      if (p.check(TokenType.CONSTRAINT) || p.check(TokenType.CONSTRAINTS)) {
        children.push(p.advance());
        while (!p.isAtEnd() && !p.check(TokenType.Semicolon)) {
          children.push(p.advance());
        }
        return makeNode("SetConstraintsStatement", children, p.makeRange(start));
      }
      // SET ROLE ... or other SET statements
      while (!p.isAtEnd() && !p.check(TokenType.Semicolon)) {
        children.push(p.advance());
      }
      return makeNode("SetStatement", children, p.makeRange(start));
    }

    default: {
      children.push(p.advance());
      while (!p.isAtEnd() && !p.check(TokenType.Semicolon)) {
        children.push(p.advance());
      }
      return makeNode("TransactionControl", children, p.makeRange(start));
    }
  }
}

// ─── Misc Statements ──────────────────────────────────────────────────────

export function parseMiscStatement(p: Parser): SyntaxNode {
  const start = p.peek();
  const children: (SyntaxNode | Token)[] = [];
  const kind = start.type;

  // Consume everything until semicolon
  while (!p.isAtEnd() && !p.check(TokenType.Semicolon)) {
    children.push(p.advance());
  }

  let nodeName: string;
  switch (kind) {
    case TokenType.TRUNCATE: nodeName = "TruncateStatement"; break;
    case TokenType.RENAME: nodeName = "RenameStatement"; break;
    case TokenType.PURGE: nodeName = "PurgeStatement"; break;
    case TokenType.FLASHBACK: nodeName = "FlashbackStatement"; break;
    case TokenType.AUDIT: nodeName = "AuditStatement"; break;
    case TokenType.NOAUDIT: nodeName = "NoauditStatement"; break;
    case TokenType.ASSOCIATE: nodeName = "AssociateStatement"; break;
    case TokenType.DISASSOCIATE: nodeName = "DisassociateStatement"; break;
    case TokenType.CALL: nodeName = "CallStatement"; break;
    case TokenType.EXECUTE: nodeName = "ExecuteStatement"; break;
    default: nodeName = "MiscStatement"; break;
  }

  return makeNode(nodeName, children, p.makeRange(start));
}
