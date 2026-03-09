import {
  createConnection,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import { TextDocuments } from "vscode-languageserver";
import { parseDocument } from "./parser/index.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
    },
  };
});

documents.onDidChangeContent((change) => {
  const diagnostics = parseDocument(change.document.getText());
  connection.sendDiagnostics({
    uri: change.document.uri,
    diagnostics,
  });
});

documents.listen(connection);
connection.listen();
