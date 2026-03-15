import { Token, TokenType, KEYWORDS } from "./tokens.js";

export function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 0;
  let col = 0;
  const len = input.length;

  function ch(offset = 0): string {
    return pos + offset < len ? input[pos + offset] : "";
  }

  function advance(n = 1): string {
    const text = input.substring(pos, pos + n);
    for (let i = 0; i < n; i++) {
      if (input[pos + i] === "\n") {
        line++;
        col = 0;
      } else {
        col++;
      }
    }
    pos += n;
    return text;
  }

  function emit(type: TokenType, text: string, startOffset: number, startLine: number, startCol: number): void {
    tokens.push({ type, text, offset: startOffset, line: startLine, col: startCol });
  }

  function isLetter(c: string): boolean {
    return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c > "\x7f";
  }

  function isDigit(c: string): boolean {
    return c >= "0" && c <= "9";
  }

  function isIdentChar(c: string): boolean {
    return isLetter(c) || isDigit(c) || c === "_" || c === "$" || c === "#";
  }

  function isNewlineAt(offset: number): boolean {
    if (offset < 0) return true; // beginning of input counts
    const c = input[offset];
    return c === "\n" || c === "\r";
  }

  while (pos < len) {
    const startOffset = pos;
    const startLine = line;
    const startCol = col;
    const c = ch();

    // Whitespace
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      const start = pos;
      while (pos < len && (ch() === " " || ch() === "\t" || ch() === "\r" || ch() === "\n")) {
        advance();
      }
      // skip whitespace (don't emit)
      continue;
    }

    // Single-line comment: --
    if (c === "-" && ch(1) === "-") {
      const start = pos;
      advance(2);
      while (pos < len && ch() !== "\n") {
        advance();
      }
      if (pos < len) advance(); // consume newline
      // skip comments
      continue;
    }

    // Multi-line comment: /* ... */ (or hint: /*+ ... */)
    if (c === "/" && ch(1) === "*") {
      const isHint = ch(2) === "+";
      const start = pos;
      advance(2);
      let text = "/*";
      while (pos < len && !(ch() === "*" && ch(1) === "/")) {
        text += advance();
      }
      if (pos < len) {
        text += advance(2); // consume */
      }
      if (isHint) {
        emit(TokenType.HintComment, text, startOffset, startLine, startCol);
      }
      // Regular comments are skipped (not emitted)
      continue;
    }

    // National char string literal: N'...'
    if ((c === "N" || c === "n") && ch(1) === "'") {
      advance(2);
      let text = "N'";
      while (pos < len) {
        if (ch() === "'") {
          advance();
          text += "'";
          if (ch() === "'") {
            advance();
            text += "'";
          } else {
            break;
          }
        } else {
          text += advance();
        }
      }
      emit(TokenType.NationalStringLiteral, text, startOffset, startLine, startCol);
      continue;
    }

    // Q-string literal: Q'[...]' or q'[...]'
    if ((c === "Q" || c === "q") && ch(1) === "'") {
      advance(2); // skip Q'
      const delimiter = ch();
      const closingDelimiter = delimiter === "<" ? ">" : delimiter === "{" ? "}" : delimiter === "[" ? "]" : delimiter === "(" ? ")" : delimiter;
      advance(); // skip opening delimiter
      let body = "";
      while (pos < len) {
        if (ch() === closingDelimiter && ch(1) === "'") {
          advance(2); // skip closing delimiter and quote
          break;
        }
        body += advance();
      }
      const text = "Q'" + delimiter + body + closingDelimiter + "'";
      emit(TokenType.QStringLiteral, text, startOffset, startLine, startCol);
      continue;
    }

    // Hex string literal: X'...' or 0X'...'
    if (((c === "X" || c === "x") && ch(1) === "'") ||
        (c === "0" && (ch(1) === "X" || ch(1) === "x") && ch(2) === "'")) {
      const start = pos;
      if (c === "0") advance(); // skip 0
      advance(2); // skip X'
      let text = input.substring(start, pos);
      while (pos < len) {
        if (ch() === "'") {
          text += advance();
          // could be followed by more hex string parts: '...'
          if (ch() === "'") {
            text += advance();
          } else {
            break;
          }
        } else {
          text += advance();
        }
      }
      emit(TokenType.HexStringLiteral, text, startOffset, startLine, startCol);
      continue;
    }

    // String literal: '...'
    if (c === "'") {
      advance();
      let text = "'";
      while (pos < len) {
        if (ch() === "'") {
          advance();
          text += "'";
          if (ch() === "'") {
            advance();
            text += "'";
          } else {
            break;
          }
        } else {
          text += advance();
        }
      }
      emit(TokenType.StringLiteral, text, startOffset, startLine, startCol);
      continue;
    }

    // Quoted identifier: "..."
    if (c === '"') {
      advance();
      let text = '"';
      while (pos < len) {
        if (ch() === '"') {
          advance();
          text += '"';
          if (ch() === '"') {
            advance();
            text += '"';
          } else {
            break;
          }
        } else {
          text += advance();
        }
      }
      emit(TokenType.QuotedIdentifier, text, startOffset, startLine, startCol);
      continue;
    }

    // Numbers: digits, or dot-digits
    if (isDigit(c) || (c === "." && isDigit(ch(1)))) {
      let text = "";
      let isFloat = false;

      // Integer part
      while (pos < len && isDigit(ch())) {
        text += advance();
      }
      // Fractional part
      if (ch() === "." && ch(1) !== ".") { // not .. (double dot)
        isFloat = true;
        text += advance(); // dot
        while (pos < len && isDigit(ch())) {
          text += advance();
        }
      }
      // Exponent
      if (ch() === "E" || ch() === "e") {
        isFloat = true;
        text += advance();
        if (ch() === "+" || ch() === "-") text += advance();
        while (pos < len && isDigit(ch())) {
          text += advance();
        }
      }
      // Type suffix: D or F
      if (ch() === "D" || ch() === "d" || ch() === "F" || ch() === "f") {
        if (!isIdentChar(ch(1))) {
          isFloat = true;
          text += advance();
        }
      }

      emit(isFloat ? TokenType.NumberLiteral : TokenType.IntegerLiteral, text, startOffset, startLine, startCol);
      continue;
    }

    // Identifiers and keywords (including REM/REMARK and PRO/PROMPT)
    if (isLetter(c) || c === "_") {
      let text = "";
      while (pos < len && isIdentChar(ch())) {
        text += advance();
      }

      const upper = text.toUpperCase();

      // REM/REMARK comment (must be at start of line)
      if ((upper === "REM" || upper === "REMARK") && isNewlineAt(startOffset - 1)) {
        // Consume rest of line
        while (pos < len && ch() !== "\n") {
          text += advance();
        }
        if (pos < len) { text += advance(); } // consume newline
        // skip remark comments
        continue;
      }

      // PRO/PROMPT message (must be at start of line)
      if ((upper === "PRO" || upper === "PROMPT") && isNewlineAt(startOffset - 1)) {
        while (pos < len && ch() !== "\n") {
          text += advance();
        }
        if (pos < len) { text += advance(); }
        emit(TokenType.PromptMessage, text, startOffset, startLine, startCol);
        continue;
      }

      // Keyword lookup
      const kw = KEYWORDS[upper];
      emit(kw ?? TokenType.Identifier, text, startOffset, startLine, startCol);
      continue;
    }

    // Conditional compilation directives: $IF, $THEN, etc.
    if (c === "$" && ch(1) !== "$" && isLetter(ch(1))) {
      let text = "$";
      advance(); // skip $
      while (pos < len && isIdentChar(ch())) {
        text += advance();
      }
      const upper = text.toUpperCase();
      const kw = KEYWORDS[upper];
      emit(kw ?? TokenType.Identifier, text, startOffset, startLine, startCol);
      continue;
    }

    // Inquiry directive: $$name
    if (c === "$" && ch(1) === "$") {
      advance(2);
      let text = "$$";
      while (pos < len && (isLetter(ch()) || ch() === "_")) {
        text += advance();
      }
      emit(TokenType.InquiryDirective, text, startOffset, startLine, startCol);
      continue;
    }

    // Bind variable: :name or :number or :delimited_id
    if (c === ":" && ch(1) !== "=") {
      advance(); // skip :
      let text = ":";
      if (ch() === '"') {
        // :delimited_id
        advance();
        text += '"';
        while (pos < len && ch() !== '"') {
          text += advance();
        }
        if (pos < len) { advance(); text += '"'; }
      } else if (isDigit(ch())) {
        while (pos < len && isDigit(ch())) {
          text += advance();
        }
      } else if (isLetter(ch()) || ch() === "_") {
        while (pos < len && isIdentChar(ch())) {
          text += advance();
        }
      }
      emit(TokenType.BindVariable, text, startOffset, startLine, startCol);
      continue;
    }

    // ? as bind variable (JDBC style)
    if (c === "?") {
      advance();
      emit(TokenType.BindVariable, "?", startOffset, startLine, startCol);
      continue;
    }

    // Two-character operators (check before single-char)
    if (c === ":" && ch(1) === "=") { advance(2); emit(TokenType.Assign, ":=", startOffset, startLine, startCol); continue; }
    if (c === "*" && ch(1) === "*") { advance(2); emit(TokenType.DoubleAsterisk, "**", startOffset, startLine, startCol); continue; }
    if (c === "." && ch(1) === ".") { advance(2); emit(TokenType.DoubleDot, "..", startOffset, startLine, startCol); continue; }
    if (c === "|" && ch(1) === "|") { advance(2); emit(TokenType.Concatenation, "||", startOffset, startLine, startCol); continue; }
    if (c === "<" && ch(1) === "=") { advance(2); emit(TokenType.LessThanEquals, "<=", startOffset, startLine, startCol); continue; }
    if (c === ">" && ch(1) === "=") { advance(2); emit(TokenType.GreaterThanEquals, ">=", startOffset, startLine, startCol); continue; }
    if (c === "<" && ch(1) === ">") { advance(2); emit(TokenType.NotEquals, "<>", startOffset, startLine, startCol); continue; }
    if (c === "!" && ch(1) === "=") { advance(2); emit(TokenType.NotEquals, "!=", startOffset, startLine, startCol); continue; }
    if (c === "^" && ch(1) === "=") { advance(2); emit(TokenType.NotEquals, "^=", startOffset, startLine, startCol); continue; }
    if (c === "~" && ch(1) === "=") { advance(2); emit(TokenType.NotEquals, "~=", startOffset, startLine, startCol); continue; }
    if (c === "=" && ch(1) === ">") { advance(2); emit(TokenType.Arrow, "=>", startOffset, startLine, startCol); continue; }

    // Start command: @ or @@
    if (c === "@" && ch(1) === "@") { advance(2); emit(TokenType.StartCommand, "@@", startOffset, startLine, startCol); continue; }

    // Single-character operators and delimiters
    switch (c) {
      case "(": advance(); emit(TokenType.LeftParen, "(", startOffset, startLine, startCol); continue;
      case ")": advance(); emit(TokenType.RightParen, ")", startOffset, startLine, startCol); continue;
      case "[": advance(); emit(TokenType.LeftBracket, "[", startOffset, startLine, startCol); continue;
      case "]": advance(); emit(TokenType.RightBracket, "]", startOffset, startLine, startCol); continue;
      case "{": advance(); emit(TokenType.LeftCurly, "{", startOffset, startLine, startCol); continue;
      case "}": advance(); emit(TokenType.RightCurly, "}", startOffset, startLine, startCol); continue;
      case ",": advance(); emit(TokenType.Comma, ",", startOffset, startLine, startCol); continue;
      case ".": advance(); emit(TokenType.Dot, ".", startOffset, startLine, startCol); continue;
      case ";": advance(); emit(TokenType.Semicolon, ";", startOffset, startLine, startCol); continue;
      case ":": advance(); emit(TokenType.Colon, ":", startOffset, startLine, startCol); continue;
      case "*": advance(); emit(TokenType.Asterisk, "*", startOffset, startLine, startCol); continue;
      case "+": advance(); emit(TokenType.Plus, "+", startOffset, startLine, startCol); continue;
      case "-": advance(); emit(TokenType.Minus, "-", startOffset, startLine, startCol); continue;
      case "/": advance(); emit(TokenType.Slash, "/", startOffset, startLine, startCol); continue;
      case "=": advance(); emit(TokenType.Equals, "=", startOffset, startLine, startCol); continue;
      case "<": advance(); emit(TokenType.LessThan, "<", startOffset, startLine, startCol); continue;
      case ">": advance(); emit(TokenType.GreaterThan, ">", startOffset, startLine, startCol); continue;
      case "@": advance(); emit(TokenType.AtSign, "@", startOffset, startLine, startCol); continue;
      case "%": advance(); emit(TokenType.Percent, "%", startOffset, startLine, startCol); continue;
      case "&": advance(); emit(TokenType.Ampersand, "&", startOffset, startLine, startCol); continue;
      case "|": advance(); emit(TokenType.Bar, "|", startOffset, startLine, startCol); continue;
      case "#": advance(); emit(TokenType.Hash, "#", startOffset, startLine, startCol); continue;
      case "^": advance(); emit(TokenType.Caret, "^", startOffset, startLine, startCol); continue;
      case "~": advance(); emit(TokenType.Tilde, "~", startOffset, startLine, startCol); continue;
      case "!": advance(); emit(TokenType.Exclamation, "!", startOffset, startLine, startCol); continue;
    }

    // Unknown character — emit error token
    const errText = advance();
    emit(TokenType.Error, errText, startOffset, startLine, startCol);
  }

  emit(TokenType.EOF, "", pos, line, col);
  return tokens;
}
