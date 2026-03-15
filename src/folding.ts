import { FoldingRange, FoldingRangeKind } from "vscode-languageserver/node";
import { SyntaxNode, isToken } from "./parser/ast.js";

const FOLDABLE_KINDS = new Set([
  "Block",
  "AnonymousBlock",
  "IfStatement",
  "CaseStatement",
  "CaseExpression",
  "LoopStatement",
  "WhileLoopStatement",
  "ForRangeLoop",
  "CursorForLoop",
  "ForallStatement",
  "ExceptionSection",
  "Declarations",
  "ProcedureBody",
  "FunctionBody",
  "ProcedureDecl",
  "FunctionDecl",
  "PackageSpec",
  "PackageBody",
  "TriggerBody",
  "TypeBody",
  "CreateTable",
  "CreateView",
  "CreateIndex",
  "CreateType",
  "SelectStatement",
  "QueryBlock",
  "InsertStatement",
  "UpdateStatement",
  "DeleteStatement",
  "MergeStatement",
]);

export function getFoldingRanges(ast: SyntaxNode): FoldingRange[] {
  const ranges: FoldingRange[] = [];
  collectFoldingRanges(ast, ranges);
  return ranges;
}

function collectFoldingRanges(node: SyntaxNode, ranges: FoldingRange[]): void {
  for (const child of node.children) {
    if (isToken(child)) continue;

    if (FOLDABLE_KINDS.has(child.kind)) {
      const startLine = child.range.start.line;
      const endLine = child.range.end.line;
      if (endLine > startLine) {
        ranges.push({
          startLine,
          endLine,
          kind: FoldingRangeKind.Region,
        });
      }
    }

    collectFoldingRanges(child, ranges);
  }
}
