# Plan: PL/SQL / SQL Language Server

## Overview

A language server implementing the LSP protocol that provides IDE features for Oracle PL/SQL and SQL. It would run as a standalone process, communicating over stdio/TCP with any LSP-capable editor.

---

## 1. Technology Choice

| Option              | Pros                                                | Cons                               |
| ------------------- | --------------------------------------------------- | ---------------------------------- |
| **Rust**            | Fast parsing, low memory, tree-sitter ecosystem     | Harder to prototype                |
| **TypeScript**      | `vscode-languageserver` lib handles LSP boilerplate | Slower parsing, heavier runtime    |
| **Lua (luvit/luv)** | Fits nvim ecosystem, could reuse oradev knowledge   | No LSP server libs, tiny ecosystem |
| **Java/Kotlin**     | ANTLR has mature PL/SQL grammars already            | Heavy runtime, slow startup        |

**Recommendation**: Rust with tree-sitter for parsing, or TypeScript for faster iteration. The ANTLR `PlSql.g4` grammar (GitHub: antlr/grammars-v4) is the most complete existing PL/SQL grammar — it could bootstrap either approach.

---

## 2. Architecture

```
┌─────────────┐     stdio/TCP      ┌──────────────────────────┐
│   Editor     │ ◄────LSP JSON────► │   Language Server         │
│ (nvim, vsc)  │                    │                           │
└─────────────┘                    │  ┌─────────────────────┐  │
                                   │  │  LSP Transport Layer │  │
                                   │  └────────┬────────────┘  │
                                   │           │               │
                                   │  ┌────────▼────────────┐  │
                                   │  │  Request Router      │  │
                                   │  └────────┬────────────┘  │
                                   │           │               │
                          ┌────────┼───────────┼───────────┐   │
                          │        │           │           │   │
                   ┌──────▼───┐ ┌──▼─────┐ ┌──▼─────┐ ┌──▼──┐│
                   │ Parser / │ │Semantic│ │Catalog │ │Diag ││
                   │   AST    │ │Analysis│ │ Cache  │ │nostic││
                   └──────────┘ └────────┘ └────────┘ └─────┘│
                                               │             │
                                        ┌──────▼──────┐      │
                                        │ DB Metadata │      │
                                        │  Provider   │      │
                                        └─────────────┘      │
                                   └──────────────────────────┘
```

### Core components

1. **LSP Transport** — JSON-RPC over stdio. Use `vscode-languageserver` (TS) or `tower-lsp` (Rust).

2. **Parser / AST** — Parses SQL and PL/SQL into a concrete syntax tree. Two approaches:
   - **Tree-sitter**: Write or adapt a `tree-sitter-plsql` grammar. Incremental reparsing on edits. No complete PL/SQL grammar exists today — would need to be built.
   - **ANTLR**: Use the existing `PlSqlLexer.g4` / `PlSqlParser.g4` from `antlr/grammars-v4`. Very complete but not incremental — full reparse on every edit.

3. **Semantic Model** — Walks the AST to build:
   - Symbol table (variables, parameters, cursors, types, record fields)
   - Scope tree (block nesting, FOR loop variables, exception handlers)
   - Reference graph (what references what)

4. **Catalog Cache** — Mirrors the Oracle data dictionary locally:
   - Tables, views, columns, types
   - Packages (spec signatures), functions, procedures
   - Synonyms, sequences
   - Populated via DB connection or offline dump

5. **Diagnostics Engine** — Produces warnings/errors from the semantic model.

---

## 3. LSP Capabilities — Phased Rollout

### Phase 1: Parse + Diagnostics (no DB connection needed)

| Capability                        | What it does                                                         |
| --------------------------------- | -------------------------------------------------------------------- |
| `textDocument/publishDiagnostics` | Syntax errors from parser                                            |
| `textDocument/documentSymbol`     | Outline: procedures, functions, variables, cursors                   |
| `textDocument/foldingRange`       | Fold BEGIN/END, IF, LOOP, CASE blocks                                |
| `textDocument/formatting`         | Reformat SQL/PL/SQL (could shell out to SQLcl `FORMAT` or build own) |

**Work**:

- Build or adapt tree-sitter-plsql grammar covering: SELECT, DML, DDL, PL/SQL blocks, packages, triggers, types
- Implement document store (open files, incremental sync)
- Map parse errors to LSP diagnostics
- Walk AST for symbols and fold ranges

### Phase 2: Local Intelligence (single-file, no DB)

| Capability                   | What it does                                                 |
| ---------------------------- | ------------------------------------------------------------ |
| `textDocument/completion`    | Keywords, local variables, parameters, cursor columns        |
| `textDocument/hover`         | Show variable type, parameter mode (IN/OUT), cursor SQL      |
| `textDocument/definition`    | Go to local variable declaration, cursor definition          |
| `textDocument/references`    | Find all references to a variable/parameter within the block |
| `textDocument/rename`        | Rename local variables safely                                |
| `textDocument/signatureHelp` | Parameter hints for local procedures/functions               |

**Work**:

- Build scope-aware symbol table from AST
- Resolve references within a single compilation unit
- Keyword + snippet completion provider
- Type inference for `%TYPE`, `%ROWTYPE`, cursor `FOR` loop variables

### Phase 3: Catalog-Aware Intelligence (DB connection)

| Capability                 | What it does                                                   |
| -------------------------- | -------------------------------------------------------------- |
| `textDocument/completion`  | Table names, column names, package members, built-in functions |
| `textDocument/hover`       | Column types, table comments, package procedure signatures     |
| `textDocument/definition`  | Jump to package spec/body source (fetched from `user_source`)  |
| `textDocument/diagnostics` | "Table X does not exist", "Column Y not in table Z"            |
| `textDocument/codeAction`  | "Create missing procedure", "Add missing column"               |

**Work**:

- Catalog provider that connects to Oracle (JDBC thin driver, or shell out to SQLcl)
- Cache `user_tables`, `user_tab_columns`, `user_objects`, `user_arguments`, `user_source`, `USER_SCHEDULER_JOBS`
- Cross-reference SQL table/column references against catalog
- Resolve `schema.package.procedure` chains
- Invalidation strategy: manual refresh, file-save trigger, or `DBMS_CHANGE_NOTIFICATION`

### Phase 4: Advanced Features

| Capability           | What it does                                                             |
| -------------------- | ------------------------------------------------------------------------ |
| Semantic tokens      | Syntax highlighting via LSP (tables, columns, types get distinct tokens) |
| Call hierarchy       | Incoming/outgoing calls between procedures                               |
| Type hierarchy       | Type inheritance for object types                                        |
| Code lens            | "N references", "Run", "Explain plan"                                    |
| Execute command      | Run statement, show explain plan, compile package                        |
| Multi-root workspace | Multiple schemas, multiple DB connections                                |

---

## 4. The Hard Problems

### 4.1 PL/SQL Grammar Completeness

PL/SQL is enormous. Key constructs to cover:

```
- Anonymous blocks, named procedures/functions
- Package spec + body
- Triggers (DML, DDL, INSTEAD OF, compound)
- Object types + type bodies
- Cursor declarations, cursor FOR loops, bulk collect
- Dynamic SQL (EXECUTE IMMEDIATE, DBMS_SQL)
- Exception handlers, PRAGMA
- Collections (nested tables, varrays, associative arrays)
- Pipelined/aggregate functions
- SQL within PL/SQL (static SQL, FORALL, BULK COLLECT)
- Conditional compilation ($IF, $THEN, $END)
- Edition-based redefinition
```

The ANTLR `PlSql.g4` covers ~90% of this. A tree-sitter grammar would need to be built incrementally, prioritizing the most common constructs first.

### 4.2 SQL Dialect Specifics

Oracle SQL has many non-standard features:

- `CONNECT BY` / `START WITH` (hierarchical queries)
- `MODEL` clause
- `PIVOT` / `UNPIVOT`
- Flashback queries (`AS OF TIMESTAMP`)
- Multi-table `INSERT`
- `MERGE`
- Analytic functions with `OVER` clause
- `JSON_TABLE`, `XMLTABLE`
- Hints (`/*+ ... */`)

### 4.3 Name Resolution

Oracle name resolution is context-dependent:

- Unqualified `FOO` could be: local variable, table, synonym, package, schema
- Resolution order: local scope → package scope → schema objects → public synonyms
- Schema qualification: `SCHEMA.TABLE.COLUMN` vs `TABLE.COLUMN` vs `TABLE_ALIAS.COLUMN`
- Must handle quoted identifiers (`"mixedCase"`)

### 4.4 Error Recovery

Users type incomplete code constantly. The parser must recover gracefully:

- Incomplete `SELECT` (no `FROM` yet)
- Unclosed `BEGIN` block
- Missing semicolons
- Typing inside a string literal

Tree-sitter has built-in error recovery. ANTLR needs custom error strategies.

---

## 5. Configuration / Settings

Project-level settings live in `oradev.json` at the project root. This file contains **only** LSP behavior settings — **no connection information**. Connections are sourced from:

1. **Editor** — the active connection passed by the editor/plugin (e.g., oradev.nvim's current worksheet connection)

```jsonc
// oradev.json (project root)
{
  "formatting": {
    "keywordCase": "upper", // upper | lower | preserve
    "indentWidth": 2,
    "commaStyle": "trailing", // trailing | leading
  },
  "diagnostics": {
    "unknownTable": "warning",
    "unknownColumn": "warning",
    "unusedVariable": "hint",
  },
  "defaultConnection": "dev-db", // name from ~/.dbtools, used when no editor connection is active
  "sqlclPath": "sql", // path to sqlcl binary
}
```

The LSP server discovers connections by:

- Accepting the active connection from the editor via LSP custom notifications (e.g., `oradev/setConnection`)
- Never storing credentials or connection strings itself

---

## 6. Existing Work / References

| Project                      | Notes                                                      |
| ---------------------------- | ---------------------------------------------------------- |
| **antlr/grammars-v4 PlSql**  | Most complete PL/SQL grammar, actively maintained          |
| **tree-sitter-sql**          | Basic SQL grammar, no PL/SQL                               |
| **pgFormatter**              | PostgreSQL formatter — architecture reference              |
| **sqls** (Go)                | Generic SQL LSP — simple, good reference for LSP structure |
| **sql-language-server** (TS) | Another generic SQL LSP                                    |
| **Oracle SQL Developer**     | Gold standard for PL/SQL tooling, closed source            |
| **utPLSQL**                  | PL/SQL testing framework — potential integration           |

---

## 7. Estimated Scope

| Phase                                      | Effort | Deliverable                                     |
| ------------------------------------------ | ------ | ----------------------------------------------- |
| Grammar (tree-sitter or ANTLR integration) | Large  | Parser that handles 80%+ of real-world PL/SQL   |
| Phase 1 (parse + diagnostics)              | Medium | Usable LSP with syntax errors, outline, folding |
| Phase 2 (local intelligence)               | Medium | Completion, hover, go-to-def for local symbols  |
| Phase 3 (catalog-aware)                    | Large  | Table/column completion, cross-DB validation    |
| Phase 4 (advanced)                         | Large  | Semantic tokens, call hierarchy, execute        |

The grammar is the single biggest risk. Everything else is well-understood LSP plumbing. Starting from the ANTLR grammar significantly de-risks Phase 1.

---

## 8. Recommended First Steps

1. **Spike**: Wire up a minimal LSP server (TypeScript or Rust) that opens, syncs documents, and returns zero diagnostics. Confirm it works in nvim + VS Code.
2. **Grammar**: Fork the ANTLR PL/SQL grammar, convert to tree-sitter. Parse a corpus of real PL/SQL files, measure parse success rate.
3. **Phase 1**: Ship syntax errors + document symbols. This alone is useful and validates the architecture.
4. **Iterate**: Each phase builds on the previous. The catalog provider in Phase 3 could reuse oradev.nvim's SQLcl integration pattern.
