# PL/SQL Language Server

A language server implementing the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) for Oracle PL/SQL and SQL.

## Status

Early stage — Phase 1 (parse + diagnostics) is in progress.

## Features

- Hand-written recursive descent lexer and parser for PL/SQL and SQL
- Real-time syntax diagnostics over LSP
- Supports SELECT, INSERT, UPDATE, DELETE, MERGE
- DDL: CREATE/ALTER/DROP for tables, views, indexes, sequences, procedures, functions, packages
- PL/SQL blocks: DECLARE/BEGIN/END, IF, LOOP, FOR, WHILE, CASE, CURSOR, EXCEPTION
- Transaction control: COMMIT, ROLLBACK, SAVEPOINT
- Error recovery — parser continues after syntax errors

## Getting Started

### Prerequisites

- Node.js >= 18
- npm

### Install

```sh
npm install
```

### Build

```sh
npm run build
```

### Run

```sh
npm start
```

The server communicates over stdio using JSON-RPC, as expected by LSP clients.

### Test

```sh
npm test
```

Watch mode:

```sh
npm run test:watch
```

## Project Structure

```
src/
  server.ts          LSP server entry point (JSON-RPC over stdio)
  parser/
    index.ts         parseDocument() — main entry point
    lexer.ts         Hand-written lexer
    tokens.ts        Token types and keyword table
    parser.ts        Parser base class (token navigation, diagnostics, error recovery)
    expressions.ts   Expression parsing
    dml.ts           SELECT, INSERT, UPDATE, DELETE, MERGE
    ddl.ts           CREATE, ALTER, DROP
    plsql.ts         PL/SQL blocks, control flow
    misc.ts          GRANT, REVOKE, COMMENT, transaction control
    ast.ts           AST node types
tests/
  lexer.test.ts      Lexer unit tests
  parser.test.ts     Parser tests (parse-without-errors)
  diagnostics.test.ts  End-to-end diagnostics tests
```

## Configuration

Project settings go in `oradev.json` at the project root. Database connections are provided by the editor plugin via LSP custom notifications — no credentials are stored in config files.

## License

MIT
