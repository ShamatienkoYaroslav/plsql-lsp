import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
} from "vscode-languageserver/node";
import { SyntaxNode } from "./parser/ast.js";
import {
  buildSymbolTable,
  findScopeAtPosition,
  SymbolType,
  Scope,
  SymbolInfo,
} from "./symbolTable.js";
import type { CatalogProvider } from "./catalogProvider.js";
import type { CatalogColumn } from "./catalogTypes.js";

// ─── Keyword list ──────────────────────────────────────────────────────────

const PLSQL_KEYWORDS = [
  // PL/SQL block structure
  "DECLARE", "BEGIN", "END", "EXCEPTION", "WHEN", "THEN", "ELSE",
  // Control flow
  "IF", "ELSIF", "LOOP", "WHILE", "FOR", "IN", "REVERSE", "EXIT", "CONTINUE",
  "CASE", "RETURN", "GOTO", "NULL",
  // Declarations
  "PROCEDURE", "FUNCTION", "PACKAGE", "BODY", "TRIGGER",
  "TYPE", "SUBTYPE", "RECORD", "TABLE", "VARRAY", "REF",
  "CURSOR", "IS", "AS", "DEFAULT", "CONSTANT",
  // Parameters
  "OUT", "NOCOPY",
  // DML
  "SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "INTO", "FROM", "WHERE",
  "SET", "VALUES", "RETURNING", "BULK", "COLLECT", "FORALL",
  // SQL clauses
  "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "CROSS", "ON",
  "GROUP", "BY", "HAVING", "ORDER", "ASC", "DESC", "NULLS", "FIRST", "LAST",
  "UNION", "ALL", "INTERSECT", "MINUS", "DISTINCT", "UNIQUE",
  "AND", "OR", "NOT", "BETWEEN", "LIKE", "EXISTS", "ANY", "SOME",
  // DDL
  "CREATE", "ALTER", "DROP", "TRUNCATE", "RENAME", "GRANT", "REVOKE",
  "VIEW", "INDEX", "SEQUENCE", "SYNONYM", "DATABASE", "LINK",
  // Data types
  "NUMBER", "VARCHAR2", "CHAR", "DATE", "TIMESTAMP", "BOOLEAN",
  "INTEGER", "PLS_INTEGER", "BINARY_INTEGER", "BINARY_FLOAT", "BINARY_DOUBLE",
  "CLOB", "BLOB", "NCLOB", "NCHAR", "NVARCHAR2", "RAW", "LONG",
  "ROWID", "UROWID", "XMLTYPE", "JSON",
  // Cursor operations
  "OPEN", "FETCH", "CLOSE",
  // Exception handling
  "RAISE", "RAISE_APPLICATION_ERROR",
  "NO_DATA_FOUND", "TOO_MANY_ROWS", "DUP_VAL_ON_INDEX", "ZERO_DIVIDE",
  "INVALID_NUMBER", "VALUE_ERROR", "OTHERS",
  // Transaction
  "COMMIT", "ROLLBACK", "SAVEPOINT",
  // Dynamic SQL
  "EXECUTE", "IMMEDIATE", "USING",
  // Pragmas
  "PRAGMA", "AUTONOMOUS_TRANSACTION", "EXCEPTION_INIT", "RESTRICT_REFERENCES",
  // Misc
  "REPLACE", "EDITIONABLE", "NONEDITIONABLE", "AUTHID", "CURRENT_USER", "DEFINER",
  "DETERMINISTIC", "PIPELINED", "PARALLEL_ENABLE", "RESULT_CACHE",
  "WITH",
];

const UNIQUE_KEYWORDS = [...new Set(PLSQL_KEYWORDS)];

// ─── Snippet definitions ─────────────────────────────────────────────────────

interface SnippetDef {
  label: string;
  insertText: string;
  detail: string;
}

const SNIPPETS: SnippetDef[] = [
  {
    label: "IF",
    insertText: "IF ${1:condition} THEN\n\t$0\nEND IF;",
    detail: "IF ... THEN ... END IF",
  },
  {
    label: "IF ELSE",
    insertText: "IF ${1:condition} THEN\n\t$2\nELSE\n\t$0\nEND IF;",
    detail: "IF ... THEN ... ELSE ... END IF",
  },
  {
    label: "FOR LOOP",
    insertText: "FOR ${1:i} IN ${2:1}..${3:10} LOOP\n\t$0\nEND LOOP;",
    detail: "FOR ... IN ... LOOP ... END LOOP",
  },
  {
    label: "FOR CURSOR",
    insertText: "FOR ${1:rec} IN ${2:cursor_name} LOOP\n\t$0\nEND LOOP;",
    detail: "FOR ... IN cursor LOOP ... END LOOP",
  },
  {
    label: "WHILE LOOP",
    insertText: "WHILE ${1:condition} LOOP\n\t$0\nEND LOOP;",
    detail: "WHILE ... LOOP ... END LOOP",
  },
  {
    label: "LOOP",
    insertText: "LOOP\n\t$0\n\tEXIT WHEN ${1:condition};\nEND LOOP;",
    detail: "LOOP ... EXIT WHEN ... END LOOP",
  },
  {
    label: "BEGIN END",
    insertText: "BEGIN\n\t$0\nEND;",
    detail: "BEGIN ... END block",
  },
  {
    label: "BEGIN EXCEPTION",
    insertText: "BEGIN\n\t$1\nEXCEPTION\n\tWHEN ${2:OTHERS} THEN\n\t\t$0\nEND;",
    detail: "BEGIN ... EXCEPTION ... END block",
  },
  {
    label: "DECLARE BEGIN",
    insertText: "DECLARE\n\t${1:v_var} ${2:NUMBER};\nBEGIN\n\t$0\nEND;",
    detail: "DECLARE ... BEGIN ... END block",
  },
  {
    label: "CURSOR",
    insertText: "CURSOR ${1:c_name} IS\n\tSELECT ${2:*}\n\tFROM ${3:table_name};",
    detail: "CURSOR ... IS SELECT ...",
  },
  {
    label: "PROCEDURE",
    insertText: "PROCEDURE ${1:proc_name}${2: (${3:p_param} IN ${4:NUMBER})} IS\nBEGIN\n\t$0\nEND ${1:proc_name};",
    detail: "PROCEDURE ... IS BEGIN ... END",
  },
  {
    label: "FUNCTION",
    insertText: "FUNCTION ${1:func_name}${2: (${3:p_param} IN ${4:NUMBER})} RETURN ${5:NUMBER} IS\nBEGIN\n\tRETURN $0;\nEND ${1:func_name};",
    detail: "FUNCTION ... RETURN ... IS BEGIN ... END",
  },
  {
    label: "CASE WHEN",
    insertText: "CASE\n\tWHEN ${1:condition} THEN ${2:result}\n\tELSE ${3:default}\nEND",
    detail: "CASE WHEN ... THEN ... END",
  },
  {
    label: "EXCEPTION WHEN",
    insertText: "EXCEPTION\n\tWHEN ${1:OTHERS} THEN\n\t\t$0",
    detail: "EXCEPTION WHEN ... THEN",
  },
  {
    label: "EXECUTE IMMEDIATE",
    insertText: "EXECUTE IMMEDIATE '${1:sql_string}'${2: INTO ${3:variable}}${4: USING ${5:bind_var}};",
    detail: "EXECUTE IMMEDIATE ... INTO ... USING",
  },
  {
    label: "BULK COLLECT",
    insertText: "SELECT ${1:*}\nBULK COLLECT INTO ${2:collection}\nFROM ${3:table_name};",
    detail: "SELECT ... BULK COLLECT INTO ...",
  },
  {
    label: "FORALL",
    insertText: "FORALL ${1:i} IN ${2:collection}.FIRST..${2:collection}.LAST\n\t$0",
    detail: "FORALL ... IN collection.FIRST..LAST",
  },
  {
    label: "RAISE_APPLICATION_ERROR",
    insertText: "RAISE_APPLICATION_ERROR(${1:-20000}, '${2:Error message}');",
    detail: "RAISE_APPLICATION_ERROR(-20000, 'msg')",
  },
  {
    label: "CREATE PROCEDURE",
    insertText: "CREATE OR REPLACE PROCEDURE ${1:proc_name}${2: (${3:p_param} IN ${4:NUMBER})} IS\nBEGIN\n\t$0\nEND ${1:proc_name};\n/",
    detail: "CREATE OR REPLACE PROCEDURE ...",
  },
  {
    label: "CREATE FUNCTION",
    insertText: "CREATE OR REPLACE FUNCTION ${1:func_name}${2: (${3:p_param} IN ${4:NUMBER})} RETURN ${5:NUMBER} IS\nBEGIN\n\tRETURN $0;\nEND ${1:func_name};\n/",
    detail: "CREATE OR REPLACE FUNCTION ...",
  },
  {
    label: "CREATE PACKAGE",
    insertText: "CREATE OR REPLACE PACKAGE ${1:pkg_name} IS\n\t$0\nEND ${1:pkg_name};\n/",
    detail: "CREATE OR REPLACE PACKAGE ...",
  },
  {
    label: "CREATE PACKAGE BODY",
    insertText: "CREATE OR REPLACE PACKAGE BODY ${1:pkg_name} IS\n\t$0\nEND ${1:pkg_name};\n/",
    detail: "CREATE OR REPLACE PACKAGE BODY ...",
  },
];

// ─── Symbol type → CompletionItemKind mapping ──────────────────────────────

function symbolKind(sym: SymbolInfo): CompletionItemKind {
  switch (sym.symbolType) {
    case SymbolType.Variable:
    case SymbolType.Constant:
    case SymbolType.ForLoopVariable:
    case SymbolType.Parameter:
      return CompletionItemKind.Variable;
    case SymbolType.Cursor:
      return CompletionItemKind.Interface;
    case SymbolType.Exception:
      return CompletionItemKind.Event;
    case SymbolType.Procedure:
    case SymbolType.Function:
      return CompletionItemKind.Function;
    case SymbolType.Type:
    case SymbolType.Subtype:
      return CompletionItemKind.Class;
    case SymbolType.RecordField:
      return CompletionItemKind.Field;
    case SymbolType.Label:
      return CompletionItemKind.Constant;
  }
}

function symbolDetail(sym: SymbolInfo): string | undefined {
  switch (sym.symbolType) {
    case SymbolType.Parameter: {
      const parts: string[] = [];
      if (sym.parameterMode) parts.push(sym.parameterMode);
      if (sym.dataType) parts.push(sym.dataType);
      return parts.length > 0 ? parts.join(" ") : undefined;
    }
    case SymbolType.Variable:
    case SymbolType.Constant:
    case SymbolType.ForLoopVariable:
      return sym.dataType;
    case SymbolType.Procedure:
      return "procedure";
    case SymbolType.Function:
      return "function";
    default:
      return undefined;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function isIdentChar(ch: number): boolean {
  // A-Z, a-z, 0-9, _, $, #
  return (
    (ch >= 65 && ch <= 90) ||
    (ch >= 97 && ch <= 122) ||
    (ch >= 48 && ch <= 57) ||
    ch === 95 || // _
    ch === 36 || // $
    ch === 35    // #
  );
}

function offsetToPosition(text: string, offset: number): { offset: number; line: number; col: number } {
  let line = 0;
  let lastNewline = -1;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastNewline = i;
    }
  }
  return { offset, line, col: offset - lastNewline - 1 };
}

function collectScopeSymbols(scope: Scope): SymbolInfo[] {
  const result: SymbolInfo[] = [];
  let current: Scope | null = scope;
  while (current !== null) {
    for (const sym of current.symbols.values()) {
      result.push(sym);
    }
    current = current.parent;
  }
  return result;
}

// ─── Catalog helpers ────────────────────────────────────────────────────────

function formatColumnType(col: CatalogColumn): string {
  const t = col.dataType;
  if (col.dataPrecision != null) {
    if (col.dataScale != null && col.dataScale > 0) {
      return `${t}(${col.dataPrecision},${col.dataScale})`;
    }
    return `${t}(${col.dataPrecision})`;
  }
  if (col.dataLength != null && /CHAR|VARCHAR|RAW/i.test(t)) {
    return `${t}(${col.dataLength})`;
  }
  return t;
}

const OBJECT_TYPE_KIND: Record<string, CompletionItemKind> = {
  "PACKAGE": CompletionItemKind.Module,
  "PROCEDURE": CompletionItemKind.Function,
  "FUNCTION": CompletionItemKind.Function,
  "SEQUENCE": CompletionItemKind.Constant,
  "VIEW": CompletionItemKind.Struct,
  "SYNONYM": CompletionItemKind.Reference,
};

// ─── Main ──────────────────────────────────────────────────────────────────

export function getCompletions(
  ast: SyntaxNode,
  text: string,
  offset: number,
  catalog?: CatalogProvider,
): CompletionItem[] {
  const table = buildSymbolTable(ast);
  const position = offsetToPosition(text, offset);

  // Find word prefix
  let wordStart = offset;
  while (wordStart > 0 && isIdentChar(text.charCodeAt(wordStart - 1))) {
    wordStart--;
  }
  const prefix = text.slice(wordStart, offset).toUpperCase();

  const items: CompletionItem[] = [];
  const snippetLabels = new Set(SNIPPETS.map(s => s.label.toUpperCase()));

  // Scope-aware local symbols
  const scope = findScopeAtPosition(table, position);
  const symbols = collectScopeSymbols(scope);
  for (const sym of symbols) {
    if (prefix.length > 0 && !sym.normalizedName.startsWith(prefix)) continue;
    items.push({
      label: sym.name,
      kind: symbolKind(sym),
      detail: symbolDetail(sym),
      sortText: "0" + sym.name,
    });
  }

  // Keyword completions (skip keywords that have a snippet with the same label)
  for (const kw of UNIQUE_KEYWORDS) {
    if (snippetLabels.has(kw)) continue;
    if (prefix.length > 0 && !kw.startsWith(prefix)) continue;
    items.push({
      label: kw,
      kind: CompletionItemKind.Keyword,
      sortText: "1" + kw,
    });
  }

  // Snippet completions
  for (const snip of SNIPPETS) {
    // Match against the first word of the snippet label
    if (prefix.length > 0 && !snip.label.toUpperCase().startsWith(prefix)) continue;
    items.push({
      label: snip.label,
      kind: CompletionItemKind.Snippet,
      detail: snip.detail,
      insertText: snip.insertText,
      insertTextFormat: InsertTextFormat.Snippet,
      sortText: "2" + snip.label, // sort after keywords
    });
  }

  // Catalog completions
  if (catalog?.isConnected) {
    const afterDot = wordStart > 0 && text[wordStart - 1] === ".";

    if (afterDot) {
      let qualEnd = wordStart - 1;
      let qualStart = qualEnd;
      while (qualStart > 0 && isIdentChar(text.charCodeAt(qualStart - 1))) {
        qualStart--;
      }
      const qualifier = text.slice(qualStart, qualEnd).toUpperCase();

      const table = catalog.getTable(qualifier);
      if (table) {
        for (const col of table.columns) {
          if (prefix.length > 0 && !col.columnName.toUpperCase().startsWith(prefix)) continue;
          items.push({
            label: col.columnName,
            kind: CompletionItemKind.Field,
            detail: formatColumnType(col),
            sortText: "0" + col.columnName,
          });
        }
      }

      const pkgObj = catalog.getObject(qualifier);
      if (pkgObj && pkgObj.objectType === "PACKAGE") {
        const seen = new Set<string>();
        for (const obj of catalog.getObjects()) {
          if (obj.objectType !== "PROCEDURE" && obj.objectType !== "FUNCTION") continue;
          const args = catalog.getArguments(obj.objectName, qualifier);
          if (args.length === 0) continue;
          if (seen.has(obj.objectName)) continue;
          seen.add(obj.objectName);
          if (prefix.length > 0 && !obj.objectName.toUpperCase().startsWith(prefix)) continue;
          items.push({
            label: obj.objectName,
            kind: CompletionItemKind.Function,
            detail: obj.objectType.toLowerCase(),
            sortText: "0" + obj.objectName,
          });
        }
        // Also check arguments keyed by package.member
        const allArgs = catalog.getObjects();
        const argKeys = new Set<string>();
        for (const o of allArgs) {
          const args = catalog.getArguments(o.objectName, qualifier);
          if (args.length > 0) argKeys.add(o.objectName);
        }
        // Try direct argument lookup for all possible members
        // The above loop already covers this via getArguments
      }
    } else {
      for (const table of catalog.getTables()) {
        if (prefix.length > 0 && !table.tableName.toUpperCase().startsWith(prefix)) continue;
        items.push({
          label: table.tableName,
          kind: CompletionItemKind.Struct,
          detail: table.comments ?? "table",
          sortText: "3" + table.tableName,
        });
      }

      for (const obj of catalog.getObjects()) {
        const kind = OBJECT_TYPE_KIND[obj.objectType];
        if (!kind) continue;
        if (prefix.length > 0 && !obj.objectName.toUpperCase().startsWith(prefix)) continue;
        items.push({
          label: obj.objectName,
          kind,
          detail: obj.objectType.toLowerCase(),
          sortText: "3" + obj.objectName,
        });
      }
    }
  }

  return items;
}
