import {
  createConnection,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  DiagnosticSeverity,
} from "vscode-languageserver/node";

import { fileURLToPath } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { TextDocuments } from "vscode-languageserver";
import { parseDocument, ParseResult } from "./parser/index.js";
import { SyntaxNode } from "./parser/ast.js";
import { getDocumentSymbols } from "./symbols.js";
import { getFoldingRanges } from "./folding.js";
import { formatDocument } from "./formatting.js";
import { getCompletions } from "./completion.js";
import { getHover } from "./hover.js";
import { getDefinition } from "./definition.js";
import { getReferences } from "./references.js";
import { getRenameEdits, prepareRename } from "./rename.js";
import { getSignatureHelp } from "./signatureHelp.js";
import { getUnusedDiagnostics } from "./unusedDiagnostics.js";
import { getCatalogDiagnostics } from "./catalogDiagnostics.js";
import { getCodeActions } from "./codeActions.js";
import { getSemanticTokens, tokenTypes, tokenModifiers } from "./semanticTokens.js";
import { prepareCallHierarchy, getIncomingCalls, getOutgoingCalls } from "./callHierarchy.js";
import { prepareTypeHierarchy, getSupertypes, getSubtypes } from "./typeHierarchy.js";
import { getCodeLenses } from "./codeLens.js";
import { executeCommand, COMMANDS } from "./executeCommand.js";
import { CatalogProvider } from "./catalogProvider.js";
import { loadConfig, ProjectConfig, mapSeverity } from "./config.js";
import { WorkspaceManager } from "./workspaceManager.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const parseCache = new Map<string, ParseResult>();
let catalogProvider: CatalogProvider | null = null;
let config: ProjectConfig = {};
const workspaceManager = new WorkspaceManager();

/** Get the catalog provider for a document, falling back to the global one. */
function getCatalog(uri?: string): CatalogProvider | undefined {
  if (uri) {
    const wsCatalog = workspaceManager.getCatalogForDocument(uri);
    if (wsCatalog?.isConnected) return wsCatalog;
  }
  return catalogProvider ?? workspaceManager.getAnyCatalog() ?? undefined;
}

function getParseResult(uri: string): ParseResult | null {
  const cached = parseCache.get(uri);
  if (cached) return cached;
  const doc = documents.get(uri);
  if (!doc) return null;
  const result = parseDocument(doc.getText());
  parseCache.set(uri, result);
  return result;
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const rootUri = params.rootUri ?? params.rootPath ?? null;
  let workspaceRoot: string | null = null;
  if (rootUri) {
    workspaceRoot = rootUri.startsWith("file://")
      ? fileURLToPath(rootUri)
      : rootUri;
  }
  config = loadConfig(workspaceRoot);

  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Full,
        save: { includeText: true },
      },
      documentSymbolProvider: true,
      foldingRangeProvider: true,
      documentFormattingProvider: true,
      completionProvider: { triggerCharacters: ["."] },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      signatureHelpProvider: { triggerCharacters: ["(", ","] },
      codeActionProvider: true,
      semanticTokensProvider: {
        legend: {
          tokenTypes,
          tokenModifiers,
        },
        full: true,
      },
      callHierarchyProvider: true,
      typeHierarchyProvider: true,
      codeLensProvider: { resolveProvider: false },
      executeCommandProvider: { commands: [...COMMANDS] },
      workspace: {
        workspaceFolders: {
          supported: true,
          changeNotifications: true,
        },
      },
    },
  };
});

connection.onInitialized(async () => {
  // Initialize workspace folders
  const folders = await connection.workspace.getWorkspaceFolders();
  if (folders) {
    for (const folder of folders) {
      const wsFolder = await workspaceManager.addFolder(folder.uri, folder.name);
      // Auto-connect folders that have a connectionName in their config
      if (wsFolder.config.connectionName) {
        try {
          await workspaceManager.connectFolder(
            folder.uri,
            wsFolder.config.connectionName,
            wsFolder.config.sqlclPath,
          );
        } catch (err) {
          connection.window.showWarningMessage(
            `Failed to connect workspace "${folder.name}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  // Fall back to single-root config if no workspace folders connected
  if (config.connectionName && !workspaceManager.getAnyCatalog()) {
    try {
      catalogProvider = new CatalogProvider(config.sqlclPath ?? "sql");
      await catalogProvider.start();
      await catalogProvider.connect(config.connectionName);
      await catalogProvider.refresh();
      connection.sendNotification("oradev/catalogReady", {
        tables: catalogProvider.getTables().length,
        objects: catalogProvider.getObjects().length,
      });
    } catch (err) {
      connection.window.showWarningMessage(
        `Failed to connect to database: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
});

connection.onDidChangeConfiguration(() => {
  // Re-read configs when settings change
});

connection.workspace.onDidChangeWorkspaceFolders(async (event) => {
  for (const removed of event.removed) {
    await workspaceManager.removeFolder(removed.uri);
  }
  for (const added of event.added) {
    const wsFolder = await workspaceManager.addFolder(added.uri, added.name);
    if (wsFolder.config.connectionName) {
      try {
        await workspaceManager.connectFolder(
          added.uri,
          wsFolder.config.connectionName,
          wsFolder.config.sqlclPath,
        );
      } catch {
        // Silently ignore connection failures for newly added folders
      }
    }
  }
});

documents.onDidChangeContent((change) => {
  const result = parseDocument(change.document.getText());
  parseCache.set(change.document.uri, result);

  // Resolve per-folder or global diagnostic severity settings
  const folder = workspaceManager.getFolderForDocument(change.document.uri);
  const diagConfig = folder?.config.diagnostics ?? config.diagnostics;

  const unusedSev = mapSeverity(diagConfig?.unusedVariableSeverity, DiagnosticSeverity.Hint);
  const unusedDiags = getUnusedDiagnostics(result.ast, unusedSev);

  const tableSev = mapSeverity(diagConfig?.unknownTableSeverity, DiagnosticSeverity.Warning);
  const columnSev = mapSeverity(diagConfig?.unknownColumnSeverity, DiagnosticSeverity.Warning);
  const catalogDiags = getCatalogDiagnostics(
    result.ast,
    change.document.getText(),
    getCatalog(change.document.uri),
    tableSev,
    columnSev,
  );

  connection.sendDiagnostics({
    uri: change.document.uri,
    diagnostics: [...result.diagnostics, ...unusedDiags, ...catalogDiags],
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
  const folder = workspaceManager.getFolderForDocument(params.textDocument.uri);
  const formatting = folder?.config.formatting ?? config.formatting;
  return formatDocument(
    doc.getText(),
    params.options.tabSize,
    params.options.insertSpaces,
    formatting,
  );
});

connection.onCompletion((params) => {
  const result = getParseResult(params.textDocument.uri);
  const doc = documents.get(params.textDocument.uri);
  if (!result || !doc) return [];
  const offset = doc.offsetAt(params.position);
  return getCompletions(result.ast, doc.getText(), offset, getCatalog(params.textDocument.uri));
});

connection.onHover((params) => {
  const result = getParseResult(params.textDocument.uri);
  const doc = documents.get(params.textDocument.uri);
  if (!result || !doc) return null;
  const offset = doc.offsetAt(params.position);
  return getHover(result.ast, doc.getText(), offset, getCatalog(params.textDocument.uri));
});

connection.onDefinition(async (params) => {
  const result = getParseResult(params.textDocument.uri);
  const doc = documents.get(params.textDocument.uri);
  if (!result || !doc) return null;
  const offset = doc.offsetAt(params.position);
  const def = await getDefinition(result.ast, doc.getText(), offset, getCatalog(params.textDocument.uri));
  if (!def) return null;
  return { uri: params.textDocument.uri, range: def.range };
});

connection.onReferences((params) => {
  const result = getParseResult(params.textDocument.uri);
  const doc = documents.get(params.textDocument.uri);
  if (!result || !doc) return [];
  const offset = doc.offsetAt(params.position);
  const refs = getReferences(result.ast, doc.getText(), offset, params.context.includeDeclaration);
  return refs.map(r => ({ uri: params.textDocument.uri, range: r.range }));
});

connection.onRenameRequest((params) => {
  const result = getParseResult(params.textDocument.uri);
  const doc = documents.get(params.textDocument.uri);
  if (!result || !doc) return null;
  const offset = doc.offsetAt(params.position);
  const edits = getRenameEdits(result.ast, doc.getText(), offset, params.newName);
  if (edits.length === 0) return null;
  return {
    changes: {
      [params.textDocument.uri]: edits.map(e => ({ range: e.range, newText: e.newText })),
    },
  };
});

connection.onSignatureHelp((params) => {
  const result = getParseResult(params.textDocument.uri);
  const doc = documents.get(params.textDocument.uri);
  if (!result || !doc) return null;
  const offset = doc.offsetAt(params.position);
  return getSignatureHelp(result.ast, doc.getText(), offset);
});

connection.onPrepareRename((params) => {
  const result = getParseResult(params.textDocument.uri);
  const doc = documents.get(params.textDocument.uri);
  if (!result || !doc) return null;
  const offset = doc.offsetAt(params.position);
  return prepareRename(result.ast, doc.getText(), offset);
});

connection.onCodeAction((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  return getCodeActions(
    params.context.diagnostics,
    doc.getText(),
    params.textDocument.uri,
    getCatalog(params.textDocument.uri),
  );
});

connection.languages.semanticTokens.on((params) => {
  const result = getParseResult(params.textDocument.uri);
  const doc = documents.get(params.textDocument.uri);
  if (!result || !doc) return { data: [] };
  const data = getSemanticTokens(result.ast, doc.getText());
  return { data };
});

connection.onCodeLens((params) => {
  const result = getParseResult(params.textDocument.uri);
  const doc = documents.get(params.textDocument.uri);
  if (!result || !doc) return [];
  return getCodeLenses(result.ast, doc.getText(), params.textDocument.uri);
});

connection.onExecuteCommand(async (params) => {
  const result = await executeCommand(params.command, params.arguments, catalogProvider ?? workspaceManager.getAnyCatalog() ?? null);
  if (!result.success) {
    connection.window.showWarningMessage(result.message);
  }
  return result;
});

connection.languages.typeHierarchy.onPrepare((params) => {
  const result = getParseResult(params.textDocument.uri);
  const doc = documents.get(params.textDocument.uri);
  if (!result || !doc) return null;
  const offset = doc.offsetAt(params.position);
  return prepareTypeHierarchy(result.ast, doc.getText(), offset, params.textDocument.uri);
});

connection.languages.typeHierarchy.onSupertypes((params) => {
  const uri = params.item.uri;
  const result = getParseResult(uri);
  const doc = documents.get(uri);
  if (!result || !doc) return [];
  return getSupertypes(params.item, result.ast, doc.getText(), uri);
});

connection.languages.typeHierarchy.onSubtypes((params) => {
  const uri = params.item.uri;
  const result = getParseResult(uri);
  const doc = documents.get(uri);
  if (!result || !doc) return [];
  return getSubtypes(params.item, result.ast, doc.getText(), uri);
});

connection.languages.callHierarchy.onPrepare((params) => {
  const result = getParseResult(params.textDocument.uri);
  const doc = documents.get(params.textDocument.uri);
  if (!result || !doc) return null;
  const offset = doc.offsetAt(params.position);
  return prepareCallHierarchy(result.ast, doc.getText(), offset, params.textDocument.uri);
});

connection.languages.callHierarchy.onIncomingCalls((params) => {
  const uri = params.item.uri;
  const result = getParseResult(uri);
  const doc = documents.get(uri);
  if (!result || !doc) return [];
  return getIncomingCalls(params.item, result.ast, doc.getText());
});

connection.languages.callHierarchy.onOutgoingCalls((params) => {
  const uri = params.item.uri;
  const result = getParseResult(uri);
  const doc = documents.get(uri);
  if (!result || !doc) return [];
  return getOutgoingCalls(params.item, result.ast, doc.getText());
});

documents.onDidClose((e) => {
  parseCache.delete(e.document.uri);
});

// Refresh catalog on save if the file contains DDL that might alter the schema
const DDL_PATTERN = /\b(CREATE|ALTER|DROP|TRUNCATE)\b/i;
documents.onDidSave((e) => {
  const text = e.document.getText();
  if (!DDL_PATTERN.test(text)) return;
  // Refresh the catalog for this document's workspace folder
  const cat = getCatalog(e.document.uri);
  if (cat?.isConnected) {
    cat.refresh().catch(() => {});
  }
});

connection.onNotification("oradev/setConnection", async (params: { connectionName: string; sqlclPath?: string; workspaceUri?: string }) => {
  if (params.workspaceUri) {
    // Connect a specific workspace folder
    await workspaceManager.connectFolder(params.workspaceUri, params.connectionName, params.sqlclPath);
    const cat = workspaceManager.getCatalogForDocument(params.workspaceUri);
    if (cat) {
      connection.sendNotification("oradev/catalogReady", {
        tables: cat.getTables().length,
        objects: cat.getObjects().length,
        workspaceUri: params.workspaceUri,
      });
    }
  } else {
    // Global connection (single-root fallback)
    if (catalogProvider) {
      try { await catalogProvider.disconnect(); } catch {}
      catalogProvider.stop();
    }
    catalogProvider = new CatalogProvider(params.sqlclPath ?? config.sqlclPath ?? "sql");
    await catalogProvider.start();
    await catalogProvider.connect(params.connectionName);
    await catalogProvider.refresh();
    connection.sendNotification("oradev/catalogReady", {
      tables: catalogProvider.getTables().length,
      objects: catalogProvider.getObjects().length,
    });
  }
});

connection.onNotification("oradev/refreshCatalog", async () => {
  if (catalogProvider?.isConnected) {
    await catalogProvider.refresh();
  }
});

connection.onNotification("oradev/disconnect", async () => {
  if (catalogProvider) {
    try { await catalogProvider.disconnect(); } catch {}
    catalogProvider.stop();
    catalogProvider = null;
  }
});

documents.listen(connection);
connection.listen();
