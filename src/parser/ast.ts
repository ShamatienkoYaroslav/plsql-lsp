import { Token } from "./tokens.js";

export interface Position {
  offset: number;
  line: number;
  col: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface SyntaxNode {
  kind: string;
  children: (SyntaxNode | Token)[];
  range: Range;
}

export interface ErrorNode extends SyntaxNode {
  kind: "Error";
  message: string;
}

export function makeNode(kind: string, children: (SyntaxNode | Token)[], range: Range): SyntaxNode {
  return { kind, children, range };
}

export function makeErrorNode(message: string, children: (SyntaxNode | Token)[], range: Range): ErrorNode {
  return { kind: "Error", message, children, range };
}

export function isToken(node: SyntaxNode | Token): node is Token {
  return "type" in node && "offset" in node && !("children" in node);
}
