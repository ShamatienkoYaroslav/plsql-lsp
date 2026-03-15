import {
  createConnection,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import { TextDocuments } from "vscode-languageserver";
import { parseDocument, ParseResult } from "./parser/index.js";
import { SyntaxNode } from "./parser/ast.js";
import { getDocumentSymbols } from "./symbols.js";
import { getFoldingRanges } from "./folding.js";
import { formatDocument } from "./formatting.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const parseCache = new Map<string, ParseResult>();

function getParseResult(uri: string): ParseResult | null {
  const cached = parseCache.get(uri);
  if (cached) return cached;
  const doc = documents.get(uri);
  if (!doc) return null;
  const result = parseDocument(doc.getText());
  parseCache.set(uri, result);
  return result;
}

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      documentSymbolProvider: true,
      foldingRangeProvider: true,
      documentFormattingProvider: true,
    },
  };
});

documents.onDidChangeContent((change) => {
  const result = parseDocument(change.document.getText());
  parseCache.set(change.document.uri, result);
  connection.sendDiagnostics({
    uri: change.document.uri,
    diagnostics: result.diagnostics,
  });
});

connection.onDocumentSymbol((params) => {
  const result = getParseResult(params.textDocument.uri);
  return result ? getDocumentSymbols(result.ast) : [];
});

connection.onFoldingRanges((params) => {
  const result = getParseResult(params.textDocument.uri);
  return result ? getFoldingRanges(result.ast) : [];
});

connection.onDocumentFormatting((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  return formatDocument(
    doc.getText(),
    params.options.tabSize,
    params.options.insertSpaces,
  );
});

documents.onDidClose((e) => {
  parseCache.delete(e.document.uri);
});

documents.listen(connection);
connection.listen();
