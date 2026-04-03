import { TextEdit } from "vscode-languageserver/node";
import { lex } from "./parser/lexer.js";
import { Token, TokenType, KEYWORDS } from "./parser/tokens.js";
import { SqlFormatOptions } from "./config.js";

/**
 * Format a PL/SQL document by adjusting keyword and identifier case
 * according to the project's SqlFormatOptions (kwCase, idCase).
 *
 * Strategy: re-lex the source to get token positions and types, then emit
 * TextEdit entries that change every keyword token to the configured case
 * and every unquoted identifier token to the configured identifier case.
 * Quoted identifiers (delimited by double-quotes) are never modified.
 * Literals and operators are left untouched.
 *
 * The `tabSize` and `insertSpaces` parameters come from the LSP client.
 * When `formatOptions.identSpaces` or `formatOptions.useTab` are provided
 * they take precedence over the LSP values for indentation purposes.
 */
export function formatDocument(
  text: string,
  tabSize: number,
  insertSpaces: boolean,
  formatOptions?: SqlFormatOptions,
): TextEdit[] {
  const kwCase = formatOptions?.kwCase ?? "upper";
  const idCase = formatOptions?.idCase ?? "preserve";

  // If both cases are "preserve" there is nothing to do.
  if (kwCase === "preserve" && idCase === "preserve") return [];

  // Resolve effective indentation settings — formatOptions overrides LSP params.
  const _effectiveTabSize = formatOptions?.identSpaces ?? tabSize;
  const _effectiveInsertSpaces = formatOptions?.useTab !== undefined
    ? !formatOptions.useTab
    : insertSpaces;
  // _effectiveTabSize and _effectiveInsertSpaces are available for future
  // indentation reformatting; prefixed with _ until that work lands.

  const tokens = lex(text);
  const edits: TextEdit[] = [];

  for (const tok of tokens) {
    if (tok.type === TokenType.EOF) break;

    // ── Keyword case ──────────────────────────────────────────────────
    if (kwCase !== "preserve" && isKeywordToken(tok)) {
      const target = kwCase === "lower"
        ? tok.text.toLowerCase()
        : tok.text.toUpperCase();
      if (target !== tok.text) {
        edits.push({
          range: {
            start: { line: tok.line, character: tok.col },
            end: { line: tok.line, character: tok.col + tok.text.length },
          },
          newText: target,
        });
      }
      continue;
    }

    // ── Identifier case (never touch QuotedIdentifier) ────────────────
    if (idCase !== "preserve" && tok.type === TokenType.Identifier) {
      const target = idCase === "lower"
        ? tok.text.toLowerCase()
        : tok.text.toUpperCase();
      if (target !== tok.text) {
        edits.push({
          range: {
            start: { line: tok.line, character: tok.col },
            end: { line: tok.line, character: tok.col + tok.text.length },
          },
          newText: target,
        });
      }
    }
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
