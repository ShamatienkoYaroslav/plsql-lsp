import { Diagnostic } from "vscode-languageserver/node";
import { lex } from "./lexer.js";
import { Parser } from "./parser.js";

export function parseDocument(text: string): Diagnostic[] {
  const tokens = lex(text);
  const parser = new Parser(tokens);
  parser.parseScript();
  return parser.diagnostics;
}
