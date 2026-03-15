import { TextEdit } from "vscode-languageserver/node";
import { lex } from "./parser/lexer.js";
import { Token, TokenType, KEYWORDS } from "./parser/tokens.js";

/**
 * Format a PL/SQL document by uppercasing keywords.
 *
 * Strategy: re-lex the source to get token positions and types, then emit
 * TextEdit entries that uppercase every keyword token whose text isn't
 * already uppercase.  Identifiers, literals, quoted identifiers, and
 * operators are left untouched.
 */
export function formatDocument(
  text: string,
  _tabSize: number,
  _insertSpaces: boolean,
): TextEdit[] {
  const tokens = lex(text);
  const edits: TextEdit[] = [];

  for (const tok of tokens) {
    if (tok.type === TokenType.EOF) break;
    if (!isKeywordToken(tok)) continue;

    const upper = tok.text.toUpperCase();
    if (upper === tok.text) continue;

    edits.push({
      range: {
        start: { line: tok.line, character: tok.col },
        end: { line: tok.line, character: tok.col + tok.text.length },
      },
      newText: upper,
    });
  }

  return edits;
}

// ── Helpers ───────────────────────────────────────────────────────────

const NON_KEYWORD_TYPES = new Set<TokenType>([
  TokenType.Identifier,
  TokenType.QuotedIdentifier,
  TokenType.StringLiteral,
  TokenType.NationalStringLiteral,
  TokenType.QStringLiteral,
  TokenType.HexStringLiteral,
  TokenType.IntegerLiteral,
  TokenType.NumberLiteral,
  TokenType.BindVariable,
  TokenType.InquiryDirective,
  TokenType.PromptMessage,
  TokenType.StartCommand,
  TokenType.Error,
]);

/** Check whether a token is a keyword that should be uppercased. */
function isKeywordToken(tok: Token): boolean {
  if (NON_KEYWORD_TYPES.has(tok.type)) return false;

  // Operator/delimiter tokens (non-alphabetic short text) are not keywords
  if (tok.text.length <= 2 && /^[^a-zA-Z]*$/.test(tok.text)) return false;

  return KEYWORDS[tok.text.toUpperCase()] !== undefined;
}
