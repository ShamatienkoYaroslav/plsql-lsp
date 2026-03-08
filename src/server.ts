import {
  createConnection,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  Diagnostic,
  DiagnosticSeverity,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import { TextDocuments } from "vscode-languageserver";
import { CharStream, CommonTokenStream, BaseErrorListener, RecognitionException, Recognizer, Token, ATNSimulator } from "antlr4ng";
import { PlSqlLexer } from "./grammar/PlSqlLexer.js";
import { PlSqlParser } from "./grammar/PlSqlParser.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

class DiagnosticErrorListener extends BaseErrorListener {
  public diagnostics: Diagnostic[] = [];

  syntaxError<S extends Token, T extends ATNSimulator>(
    _recognizer: Recognizer<T>,
    _offendingSymbol: S | null,
    line: number,
    charPositionInLine: number,
    msg: string,
    _e: RecognitionException | null,
  ): void {
    this.diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: line - 1, character: charPositionInLine },
        end: { line: line - 1, character: charPositionInLine + 1 },
      },
      message: msg,
      source: "plsql",
    });
  }
}

function parseDocument(text: string): Diagnostic[] {
  const inputStream = CharStream.fromString(text);
  const lexer = new PlSqlLexer(inputStream);
  const tokenStream = new CommonTokenStream(lexer);
  const parser = new PlSqlParser(tokenStream);

  const errorListener = new DiagnosticErrorListener();

  lexer.removeErrorListeners();
  lexer.addErrorListener(errorListener);
  parser.removeErrorListeners();
  parser.addErrorListener(errorListener);

  parser.sql_script();

  return errorListener.diagnostics;
}

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
