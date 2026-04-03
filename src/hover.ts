import { Hover, MarkupKind } from "vscode-languageserver/node";
import { SyntaxNode } from "./parser/ast.js";
import {
  buildSymbolTable,
  findScopeAtPosition,
  SymbolType,
  SymbolInfo,
  Scope,
} from "./symbolTable.js";
import type { CatalogProvider } from "./catalogProvider.js";
import type { CatalogColumn } from "./catalogTypes.js";

// ─── Helpers (copied from completion.ts) ─────────────────────────────────

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

// ─── Cursor SQL extraction ───────────────────────────────────────────────

function extractCursorSql(sym: SymbolInfo, text: string): string {
  const declText = text.slice(sym.range.start.offset, sym.range.end.offset);
  // Find IS keyword and take everything after it
  const isMatch = declText.match(/\bIS\b/i);
  if (!isMatch || isMatch.index === undefined) return "";
  let sql = declText.slice(isMatch.index + isMatch[0].length).trim();
  // Remove trailing semicolon
  if (sql.endsWith(";")) sql = sql.slice(0, -1).trimEnd();
  return sql;
}

// ─── Function return type extraction ─────────────────────────────────────

function extractFunctionReturnType(sym: SymbolInfo, text: string): string | undefined {
  const declText = text.slice(sym.range.start.offset, sym.range.end.offset);
  const returnMatch = declText.match(/\bRETURN\s+(\S+)/i);
  if (!returnMatch) return undefined;
  // Clean up: the return type might be followed by IS/AS/DETERMINISTIC etc.
  let returnType = returnMatch[1];
  // Remove trailing keywords
  returnType = returnType.replace(/;$/, "");
  return returnType;
}

// ─── Hover content building ──────────────────────────────────────────────

function buildHoverCode(sym: SymbolInfo, text: string): string {
  switch (sym.symbolType) {
    case SymbolType.Variable:
      return sym.dataType ? `${sym.name} ${sym.dataType}` : sym.name;

    case SymbolType.Constant:
      return sym.dataType ? `${sym.name} CONSTANT ${sym.dataType}` : `${sym.name} CONSTANT`;

    case SymbolType.Parameter: {
      const mode = sym.parameterMode ?? "IN";
      return sym.dataType ? `${sym.name} ${mode} ${sym.dataType}` : `${sym.name} ${mode}`;
    }

    case SymbolType.Cursor: {
      const sql = extractCursorSql(sym, text);
      return sql ? `CURSOR ${sym.name} IS ${sql}` : `CURSOR ${sym.name}`;
    }

    case SymbolType.Exception:
      return `${sym.name} EXCEPTION`;

    case SymbolType.Procedure:
      return `PROCEDURE ${sym.name}`;

    case SymbolType.Function: {
      const returnType = extractFunctionReturnType(sym, text);
      return returnType ? `FUNCTION ${sym.name} RETURN ${returnType}` : `FUNCTION ${sym.name}`;
    }

    case SymbolType.Type:
    case SymbolType.Subtype: {
      let declText = text.slice(sym.range.start.offset, sym.range.end.offset);
      // Trim trailing semicolons and whitespace
      declText = declText.replace(/;\s*$/, "").trimEnd();
      return declText;
    }

    case SymbolType.ForLoopVariable:
      return `${sym.name}  -- FOR loop variable`;

    case SymbolType.Label:
      return `<<${sym.name}>>`;

    case SymbolType.RecordField:
      return sym.dataType ? `${sym.name} ${sym.dataType}` : sym.name;
  }
}

function symbolTypeLabel(symType: SymbolType): string {
  switch (symType) {
    case SymbolType.Variable:       return "variable";
    case SymbolType.Constant:       return "constant";
    case SymbolType.Parameter:      return "parameter";
    case SymbolType.Cursor:         return "cursor";
    case SymbolType.Exception:      return "exception";
    case SymbolType.Procedure:      return "procedure";
    case SymbolType.Function:       return "function";
    case SymbolType.Type:           return "type";
    case SymbolType.Subtype:        return "subtype";
    case SymbolType.ForLoopVariable: return "for_loop_variable";
    case SymbolType.Label:          return "label";
    case SymbolType.RecordField:    return "record_field";
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

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

export function getHover(ast: SyntaxNode, text: string, offset: number, catalog?: CatalogProvider): Hover | null {
  // 1. Find the identifier token at cursor position
  let wordStart = offset;
  while (wordStart > 0 && isIdentChar(text.charCodeAt(wordStart - 1))) {
    wordStart--;
  }
  let wordEnd = offset;
  while (wordEnd < text.length && isIdentChar(text.charCodeAt(wordEnd))) {
    wordEnd++;
  }
  const word = text.slice(wordStart, wordEnd);
  if (word.length === 0) return null;

  // 2. Build symbol table and compute position
  const table = buildSymbolTable(ast);
  const position = offsetToPosition(text, offset);

  // 3. Resolve the identifier — walk scope chain
  const normalizedName = word.toUpperCase();
  const scope = findScopeAtPosition(table, position);
  let sym: SymbolInfo | undefined;
  let current: Scope | null = scope;
  while (current !== null) {
    sym = current.symbols.get(normalizedName);
    if (sym) break;
    current = current.parent;
  }

  if (!sym) {
    if (catalog?.isConnected) {
      const hoverRange = {
        start: { line: offsetToPosition(text, wordStart).line, character: offsetToPosition(text, wordStart).col },
        end: { line: offsetToPosition(text, wordEnd).line, character: offsetToPosition(text, wordEnd).col },
      };

      // Check dot notation: qualifier.member
      if (wordStart > 1 && text[wordStart - 1] === ".") {
        let qualEnd = wordStart - 1;
        let qualStart = qualEnd;
        while (qualStart > 0 && isIdentChar(text.charCodeAt(qualStart - 1))) {
          qualStart--;
        }
        const qualifier = text.slice(qualStart, qualEnd).toUpperCase();

        const table = catalog.getTable(qualifier);
        if (table) {
          const col = table.columns.find(c => c.columnName === normalizedName);
          if (col) {
            const nullable = col.nullable ? "NULL" : "NOT NULL";
            const value = `\`\`\`plsql\n${col.columnName} ${formatColumnType(col)} ${nullable}\n\`\`\`\n\n**(column)** on ${qualifier}${col.comments ? "\n\n" + col.comments : ""}`;
            return { contents: { kind: MarkupKind.Markdown, value }, range: hoverRange };
          }
        }

        const pkgObj = catalog.getObject(qualifier);
        if (pkgObj && pkgObj.objectType === "PACKAGE") {
          const args = catalog.getArguments(normalizedName, qualifier);
          if (args.length > 0) {
            const argList = args
              .filter(a => a.argumentName)
              .map(a => `${a.argumentName} ${a.inOut} ${a.dataType}`)
              .join(", ");
            const value = `\`\`\`plsql\n${qualifier}.${normalizedName}(${argList})\n\`\`\`\n\n**(package member)**`;
            return { contents: { kind: MarkupKind.Markdown, value }, range: hoverRange };
          }
        }
      }

      // Check as table name
      const table = catalog.getTable(normalizedName);
      if (table) {
        const cols = table.columns.map(c => `${c.columnName} ${formatColumnType(c)}`).join(", ");
        const value = `\`\`\`plsql\nTABLE ${table.tableName}\n\`\`\`\n\n**(table)**\n\nColumns: ${cols}`;
        return { contents: { kind: MarkupKind.Markdown, value }, range: hoverRange };
      }

      // Check as object name
      const obj = catalog.getObject(normalizedName);
      if (obj) {
        const kind = obj.objectType.toLowerCase();
        let value = `\`\`\`plsql\n${obj.objectType} ${obj.objectName}\n\`\`\`\n\n**(${kind})** — ${obj.status}`;
        if (obj.objectType === "PROCEDURE" || obj.objectType === "FUNCTION") {
          const args = catalog.getArguments(normalizedName);
          if (args.length > 0) {
            const argList = args
              .filter(a => a.argumentName)
              .map(a => `${a.argumentName} ${a.inOut} ${a.dataType}`)
              .join(", ");
            value = `\`\`\`plsql\n${obj.objectType} ${obj.objectName}(${argList})\n\`\`\`\n\n**(${kind})** — ${obj.status}`;
          }
        }
        return { contents: { kind: MarkupKind.Markdown, value }, range: hoverRange };
      }
    }

    return null;
  }

  // 4. Build hover content
  const code = buildHoverCode(sym, text);
  const label = symbolTypeLabel(sym.symbolType);
  const value = `\`\`\`plsql\n${code}\n\`\`\`\n\n**(${label})**`;

  // 5. Compute hover range
  const startPos = offsetToPosition(text, wordStart);
  const endPos = offsetToPosition(text, wordEnd);

  return {
    contents: { kind: MarkupKind.Markdown, value },
    range: {
      start: { line: startPos.line, character: startPos.col },
      end: { line: endPos.line, character: endPos.col },
    },
  };
}
