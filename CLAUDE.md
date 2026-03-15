# PL/SQL Language Server

A language server implementing LSP for Oracle PL/SQL and SQL.

## Project Status

Early stage — no code yet. See `LSP.md` for the full design plan.

## Architecture

- **LSP Transport**: JSON-RPC over stdio
- **Parser**: Tree-sitter or ANTLR-based PL/SQL grammar
- **Semantic Model**: Scope-aware symbol table, reference graph
- **Catalog Cache**: Oracle data dictionary mirror (tables, columns, packages, etc.)
- **Diagnostics Engine**: Syntax errors + semantic warnings

## Phased Rollout

1. **Phase 1**: Parse + diagnostics (syntax errors, document symbols, folding, formatting)
2. **Phase 2**: Local intelligence (completion, hover, go-to-def, references, rename)
3. **Phase 3**: Catalog-aware (DB connection, table/column completion, cross-DB validation)
4. **Phase 4**: Advanced (semantic tokens, call hierarchy, code lens, execute)

## Tech Decision

Not yet finalized. Candidates: Rust (tower-lsp + tree-sitter) or TypeScript (vscode-languageserver). ANTLR PlSql.g4 grammar from antlr/grammars-v4 is the most complete existing grammar.

## Configuration

Project settings in `oradev.json` at project root. No credentials stored — connections provided by editor plugin via LSP custom notifications.

## TypeScript

- **Agent**: Always use the `typescript-pro` agent when implementing, modifying, or refactoring TypeScript code

## Testing

- **Framework**: vitest
- **Test location**: `tests/` directory, files named `*.test.ts`
- **Run tests**: `npx vitest run`
- **Run specific test file**: `npx vitest run tests/folding.test.ts`
- **Agent**: Always use the `test-automator` agent when implementing, modifying, or debugging tests

## Commands

_(none yet — to be filled in as the project takes shape)_
