import { describe, it, expect } from "vitest";
import { lex } from "../src/parser/lexer";
import { TokenType } from "../src/parser/tokens";

function tokenTypes(input: string): TokenType[] {
  return lex(input).map((t) => t.type);
}

function tokenTexts(input: string): string[] {
  return lex(input)
    .filter((t) => t.type !== TokenType.EOF)
    .map((t) => t.text);
}

describe("Lexer", () => {
  describe("basic tokens", () => {
    it("should lex keywords", () => {
      const tokens = lex("SELECT FROM WHERE");
      expect(tokens[0].type).toBe(TokenType.SELECT);
      expect(tokens[1].type).toBe(TokenType.FROM);
      expect(tokens[2].type).toBe(TokenType.WHERE);
      expect(tokens[3].type).toBe(TokenType.EOF);
    });

    it("should lex keywords case-insensitively", () => {
      const tokens = lex("select FROM Where");
      expect(tokens[0].type).toBe(TokenType.SELECT);
      expect(tokens[1].type).toBe(TokenType.FROM);
      expect(tokens[2].type).toBe(TokenType.WHERE);
    });

    it("should lex identifiers", () => {
      const tokens = lex("my_table col1");
      expect(tokens[0].type).toBe(TokenType.Identifier);
      expect(tokens[0].text).toBe("my_table");
      expect(tokens[1].type).toBe(TokenType.Identifier);
      expect(tokens[1].text).toBe("col1");
    });

    it("should lex operators", () => {
      const types = tokenTypes("+ - * / = < >");
      expect(types).toEqual([
        TokenType.Plus,
        TokenType.Minus,
        TokenType.Asterisk,
        TokenType.Slash,
        TokenType.Equals,
        TokenType.LessThan,
        TokenType.GreaterThan,
        TokenType.EOF,
      ]);
    });

    it("should lex delimiters", () => {
      const types = tokenTypes("( ) , ; .");
      expect(types).toEqual([
        TokenType.LeftParen,
        TokenType.RightParen,
        TokenType.Comma,
        TokenType.Semicolon,
        TokenType.Dot,
        TokenType.EOF,
      ]);
    });
  });

  describe("string literals", () => {
    it("should lex simple strings", () => {
      const tokens = lex("'hello world'");
      expect(tokens[0].type).toBe(TokenType.StringLiteral);
      expect(tokens[0].text).toBe("'hello world'");
    });

    it("should lex strings with escaped quotes", () => {
      const tokens = lex("'it''s'");
      expect(tokens[0].type).toBe(TokenType.StringLiteral);
      expect(tokens[0].text).toBe("'it''s'");
    });

    it("should lex Q-string literals", () => {
      const tokens = lex("Q'[hello]'");
      expect(tokens[0].type).toBe(TokenType.QStringLiteral);
      expect(tokens[0].text).toBe("Q'[hello]'");
    });

    it("should lex Q-string with bracket delimiters", () => {
      const tokens = lex("q'{it''s easy}'");
      expect(tokens[0].type).toBe(TokenType.QStringLiteral);
      // Lexer reconstructs the text with uppercase Q prefix
      expect(tokens[0].text).toBe("Q'{it''s easy}'");
    });

    it("should lex Q-string with angle bracket delimiters", () => {
      const tokens = lex("Q'<value>'");
      expect(tokens[0].type).toBe(TokenType.QStringLiteral);
      expect(tokens[0].text).toBe("Q'<value>'");
    });

    it("should lex Q-string with paren delimiters", () => {
      const tokens = lex("Q'(value)'");
      expect(tokens[0].type).toBe(TokenType.QStringLiteral);
      expect(tokens[0].text).toBe("Q'(value)'");
    });

    it("should lex national char string literals", () => {
      const tokens = lex("N'hello'");
      expect(tokens[0].type).toBe(TokenType.NationalStringLiteral);
      expect(tokens[0].text).toBe("N'hello'");
    });

    it("should lex hex string literals", () => {
      const tokens = lex("X'FF01'");
      expect(tokens[0].type).toBe(TokenType.HexStringLiteral);
      expect(tokens[0].text).toBe("X'FF01'");
    });

    it("should lex 0x hex string literals", () => {
      const tokens = lex("0x'AB'");
      expect(tokens[0].type).toBe(TokenType.HexStringLiteral);
      expect(tokens[0].text).toBe("0x'AB'");
    });
  });

  describe("numbers", () => {
    it("should lex integers", () => {
      const tokens = lex("42 0 999");
      expect(tokens[0].type).toBe(TokenType.IntegerLiteral);
      expect(tokens[0].text).toBe("42");
      expect(tokens[1].type).toBe(TokenType.IntegerLiteral);
      expect(tokens[2].type).toBe(TokenType.IntegerLiteral);
    });

    it("should lex floats", () => {
      const tokens = lex("3.14 .5 0.0");
      expect(tokens[0].type).toBe(TokenType.NumberLiteral);
      expect(tokens[0].text).toBe("3.14");
      expect(tokens[1].type).toBe(TokenType.NumberLiteral);
      expect(tokens[1].text).toBe(".5");
      expect(tokens[2].type).toBe(TokenType.NumberLiteral);
    });

    it("should lex scientific notation", () => {
      const tokens = lex("1e10 2.5E-3 .1e+2");
      expect(tokens[0].type).toBe(TokenType.NumberLiteral);
      expect(tokens[0].text).toBe("1e10");
      expect(tokens[1].type).toBe(TokenType.NumberLiteral);
      expect(tokens[1].text).toBe("2.5E-3");
      expect(tokens[2].type).toBe(TokenType.NumberLiteral);
      expect(tokens[2].text).toBe(".1e+2");
    });
  });

  describe("comments", () => {
    it("should skip single-line comments", () => {
      const types = tokenTypes("SELECT -- comment\nFROM");
      expect(types).toEqual([TokenType.SELECT, TokenType.FROM, TokenType.EOF]);
    });

    it("should skip multi-line comments", () => {
      const types = tokenTypes("SELECT /* block\ncomment */ FROM");
      expect(types).toEqual([TokenType.SELECT, TokenType.FROM, TokenType.EOF]);
    });

    it("should skip REM comments at start of line", () => {
      const types = tokenTypes("REM this is a comment\nSELECT");
      expect(types).toEqual([TokenType.SELECT, TokenType.EOF]);
    });

    it("should skip REMARK comments at start of line", () => {
      const types = tokenTypes("REMARK this is a remark\nSELECT");
      expect(types).toEqual([TokenType.SELECT, TokenType.EOF]);
    });
  });

  describe("bind variables", () => {
    it("should lex named bind variables", () => {
      const tokens = lex(":name");
      expect(tokens[0].type).toBe(TokenType.BindVariable);
      expect(tokens[0].text).toBe(":name");
    });

    it("should lex numbered bind variables", () => {
      const tokens = lex(":1");
      expect(tokens[0].type).toBe(TokenType.BindVariable);
      expect(tokens[0].text).toBe(":1");
    });

    it("should lex ? as bind variable", () => {
      const tokens = lex("?");
      expect(tokens[0].type).toBe(TokenType.BindVariable);
      expect(tokens[0].text).toBe("?");
    });
  });

  describe("quoted identifiers", () => {
    it("should lex quoted identifiers", () => {
      const tokens = lex('"MixedCase"');
      expect(tokens[0].type).toBe(TokenType.QuotedIdentifier);
      expect(tokens[0].text).toBe('"MixedCase"');
    });

    it("should lex quoted identifiers with escaped quotes", () => {
      const tokens = lex('"has""quote"');
      expect(tokens[0].type).toBe(TokenType.QuotedIdentifier);
      expect(tokens[0].text).toBe('"has""quote"');
    });
  });

  describe("multi-character operators", () => {
    it("should lex :=", () => {
      expect(lex(":=")[0].type).toBe(TokenType.Assign);
    });

    it("should lex **", () => {
      expect(lex("**")[0].type).toBe(TokenType.DoubleAsterisk);
    });

    it("should lex ||", () => {
      expect(lex("||")[0].type).toBe(TokenType.Concatenation);
    });

    it("should lex <=", () => {
      expect(lex("<=")[0].type).toBe(TokenType.LessThanEquals);
    });

    it("should lex <>", () => {
      expect(lex("<>")[0].type).toBe(TokenType.NotEquals);
    });

    it("should lex !=", () => {
      expect(lex("!=")[0].type).toBe(TokenType.NotEquals);
    });

    it("should lex =>", () => {
      expect(lex("=>")[0].type).toBe(TokenType.Arrow);
    });

    it("should lex ..", () => {
      expect(lex("..")[0].type).toBe(TokenType.DoubleDot);
    });
  });

  describe("edge cases", () => {
    it("should handle empty input", () => {
      const tokens = lex("");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe(TokenType.EOF);
    });

    it("should track line and column numbers", () => {
      const tokens = lex("SELECT\n  FROM");
      expect(tokens[0].line).toBe(0);
      expect(tokens[0].col).toBe(0);
      expect(tokens[1].line).toBe(1);
      expect(tokens[1].col).toBe(2);
    });

    it("should lex inquiry directives", () => {
      const tokens = lex("$$PLSQL_UNIT");
      expect(tokens[0].type).toBe(TokenType.InquiryDirective);
      expect(tokens[0].text).toBe("$$PLSQL_UNIT");
    });
  });
});
