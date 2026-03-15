import { Diagnostic } from "vscode-languageserver/node";
import { lex } from "./lexer.js";
import { Parser } from "./parser.js";
import { SyntaxNode } from "./ast.js";

export interface ParseResult {
  diagnostics: Diagnostic[];
  ast: SyntaxNode;
}

export function parseDocument(text: string): ParseResult {
  const tokens = lex(text);
  const parser = new Parser(tokens);
  const ast = parser.parseScript();
  return { diagnostics: parser.diagnostics, ast };
}
