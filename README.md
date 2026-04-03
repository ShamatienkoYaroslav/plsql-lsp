# PL/SQL Language Server

A language server implementing the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) for Oracle PL/SQL and SQL.

## Status

All four phases complete — parse + diagnostics, local intelligence, catalog-aware intelligence, and advanced features. Configuration via `.dbtools/` project files fully supported.

## Features

- Hand-written recursive descent lexer and parser for PL/SQL and SQL
- Real-time syntax diagnostics over LSP
- Supports SELECT, INSERT, UPDATE, DELETE, MERGE
- DDL: CREATE/ALTER/DROP for tables, views, indexes, sequences, procedures, functions, packages
- PL/SQL blocks: DECLARE/BEGIN/END, IF, LOOP, FOR, WHILE, CASE, CURSOR, EXCEPTION
- Transaction control: COMMIT, ROLLBACK, SAVEPOINT
- Error recovery — parser continues after syntax errors
- Code completion — PL/SQL keywords, local variables, parameters, cursors, exceptions (scope-aware)
- Hover information — variable types, parameter modes, cursor SQL, procedure/function signatures
- Go to definition — jump to local variable, parameter, cursor, or procedure declaration
- Find references — find all usages of a variable, parameter, cursor, or procedure
- Rename — safely rename local variables, parameters, cursors across all references
- Signature help — parameter hints when calling local procedures/functions
- Unused variable hints — greyed-out diagnostics for declared but unused variables/parameters
- Database connection via SQLcl MCP — connect to Oracle using saved SQLcl connection names
- Catalog-aware completion — table names, column names (after dot), package members, sequences, views
- Catalog-aware hover — table column listings, column types, package procedure signatures with arguments
- Catalog diagnostics — "table X does not exist", "column Y not in table Z" warnings
- Semantic tokens — syntax-aware highlighting for variables, parameters, functions, procedures, types, cursors, exceptions, labels
- Call hierarchy — incoming and outgoing calls for procedures/functions
- Type hierarchy — supertypes and subtypes for object type inheritance (UNDER)
- Code lens — "N references" and "Run" actions on procedures/functions
- Execute command — run statement, explain plan, compile package via LSP commands
- Multi-root workspace — multiple workspace folders with independent DB connections
- Code actions — quick fixes to generate ALTER TABLE or CREATE TABLE for missing objects
- Schema-qualified name resolution — supports schema.table.column and schema.package.procedure chains
- Auto-refresh catalog on file save when DDL is detected
- Project configuration via `.dbtools/project.config.json` — default connection name, schemas
- SQLcl formatting rules via `.dbtools/project.sqlformat.xml` — keyword case, identifier case, indentation, comma breaks, alignments
- Configurable diagnostic severity — unknownTable, unknownColumn, unusedVariable (error/warning/info/hint/off)
- Per-workspace configuration — each workspace folder resolves its own config and formatting rules

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
  server.ts              LSP server entry point (JSON-RPC over stdio)
  config.ts              .dbtools/project.config.json configuration loader
  symbolTable.ts         Scope-aware symbol table, reference resolution
  completion.ts          Code completion (keywords, locals, catalog)
  hover.ts               Hover information
  definition.ts          Go to definition
  references.ts          Find all references
  rename.ts              Rename symbol
  signatureHelp.ts       Signature help (parameter hints)
  unusedDiagnostics.ts   Unused variable diagnostics
  catalogProvider.ts     Oracle catalog provider via SQLcl MCP
  catalogTypes.ts        Catalog data interfaces
  catalogDiagnostics.ts  Table/column validation against catalog
  semanticTokens.ts     Semantic token provider (syntax-aware highlighting)
  callHierarchy.ts       Incoming/outgoing call hierarchy
  typeHierarchy.ts       Type hierarchy (object type inheritance)
  codeLens.ts            Code lens (reference counts, run actions)
  executeCommand.ts      Workspace command execution
  workspaceManager.ts    Multi-root workspace folder management
  codeActions.ts         Quick fix code actions
  symbols.ts             Document symbols (outline)
  folding.ts             Folding ranges
  formatting.ts          Document formatting
  parser/
    index.ts             parseDocument() — main entry point
    lexer.ts             Hand-written lexer
    tokens.ts            Token types and keyword table
    parser.ts            Parser base class (token navigation, diagnostics, error recovery)
    expressions.ts       Expression parsing
    dml.ts               SELECT, INSERT, UPDATE, DELETE, MERGE
    ddl.ts               CREATE, ALTER, DROP
    plsql.ts             PL/SQL blocks, control flow
    misc.ts              GRANT, REVOKE, COMMENT, transaction control
    ast.ts               AST node types
tests/
  *.test.ts              27 test files, 1016 tests
```

## Neovim Setup

### Using nvim-lspconfig

Add a custom server config to your Neovim configuration:

```lua
local lspconfig = require("lspconfig")
local configs = require("lspconfig.configs")

if not configs.plsql_lsp then
  configs.plsql_lsp = {
    default_config = {
      cmd = { "node", "/absolute/path/to/plsql-lsp/dist/server.js", "--stdio" },
      filetypes = { "plsql", "sql" },
      root_dir = lspconfig.util.root_pattern(".dbtools", ".git"),
      settings = {},
    },
  }
end

lspconfig.plsql_lsp.setup({})
```

Replace `/absolute/path/to/plsql-lsp` with the actual path where you cloned and built the project.

### Without nvim-lspconfig

Using the built-in `vim.lsp.start()` (Neovim >= 0.10):

```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = { "plsql", "sql" },
  callback = function()
    vim.lsp.start({
      name = "plsql-lsp",
      cmd = { "node", "/absolute/path/to/plsql-lsp/dist/server.js", "--stdio" },
      root_dir = vim.fs.dirname(vim.fs.find({ ".dbtools", ".git" }, { upward = true })[1]),
    })
  end,
})
```

### Filetype detection

Neovim detects `.sql` files automatically. For `.pls`, `.pks`, `.pkb`, or `.prc` files, add filetype detection:

```lua
vim.filetype.add({
  extension = {
    pls = "plsql",
    pks = "plsql",
    pkb = "plsql",
    prc = "plsql",
    fnc = "plsql",
  },
})
```

## Neovim Plugin Development

This section covers building a Neovim plugin that wraps this LSP and extending the server with custom protocol methods.

### Plugin structure

A typical companion plugin layout:

```
plsql.nvim/
  lua/
    plsql/
      init.lua        Plugin entry point
      lsp.lua         LSP client setup and server management
      config.lua      User configuration and defaults
      commands.lua    User commands and keymaps
  ftdetect/
    plsql.lua         Filetype detection
  plugin/
    plsql.lua         Autoload entry point
```

### Bootstrapping the plugin

`plugin/plsql.lua` — loaded automatically by Neovim:

```lua
if vim.g.loaded_plsql then
  return
end
vim.g.loaded_plsql = true

require("plsql").setup()
```

`lua/plsql/init.lua`:

```lua
local M = {}

local defaults = {
  server_path = nil, -- required: path to plsql-lsp/dist/server.js
  filetypes = { "plsql", "sql" },
  autostart = true,
}

function M.setup(opts)
  M.config = vim.tbl_deep_extend("force", defaults, opts or {})

  require("plsql.lsp").setup(M.config)
  require("plsql.commands").setup(M.config)
end

return M
```

### Managing the LSP client

`lua/plsql/lsp.lua`:

```lua
local M = {}

function M.setup(config)
  vim.api.nvim_create_autocmd("FileType", {
    pattern = config.filetypes,
    callback = function(ev)
      if not config.autostart then
        return
      end
      M.start(ev.buf)
    end,
  })
end

function M.start(bufnr)
  local config = require("plsql").config
  assert(config.server_path, "plsql.nvim: server_path is required")

  vim.lsp.start({
    name = "plsql-lsp",
    cmd = { "node", config.server_path, "--stdio" },
    root_dir = vim.fs.dirname(
      vim.fs.find({ ".dbtools", ".git" }, { upward = true, path = vim.api.nvim_buf_get_name(bufnr) })[1]
    ),
  }, { bufnr = bufnr })
end

--- Send a custom notification to the server.
function M.notify(method, params)
  local clients = vim.lsp.get_clients({ name = "plsql-lsp" })
  for _, client in ipairs(clients) do
    client:notify(method, params)
  end
end

--- Send a custom request to the server and return the response.
function M.request(method, params, bufnr, callback)
  local clients = vim.lsp.get_clients({ name = "plsql-lsp", bufnr = bufnr })
  if #clients == 0 then
    return
  end
  clients[1]:request(method, params, callback, bufnr)
end

return M
```

### Adding user commands

`lua/plsql/commands.lua`:

```lua
local M = {}

function M.setup(_config)
  vim.api.nvim_create_user_command("PlsqlRestart", function()
    -- Stop all plsql-lsp clients, then restart on current buffer
    for _, client in ipairs(vim.lsp.get_clients({ name = "plsql-lsp" })) do
      client:stop()
    end
    vim.defer_fn(function()
      require("plsql.lsp").start(vim.api.nvim_get_current_buf())
    end, 500)
  end, {})

  vim.api.nvim_create_user_command("PlsqlConnect", function(cmd_opts)
    -- Example: send connection info to the server
    require("plsql.lsp").notify("plsql/connect", {
      connectionString = cmd_opts.args,
    })
  end, { nargs = 1, desc = "Connect to Oracle database" })
end

return M
```

### Filetype detection

`ftdetect/plsql.lua`:

```lua
vim.filetype.add({
  extension = {
    pls = "plsql",
    pks = "plsql",
    pkb = "plsql",
    prc = "plsql",
    fnc = "plsql",
  },
})
```

### User setup

Users install the plugin with their package manager and call setup:

```lua
require("plsql").setup({
  server_path = "/path/to/plsql-lsp/dist/server.js",
})
```

### Extending the LSP with custom methods

To add custom request/notification handlers, extend `src/server.ts` on the server side. The plugin can then call them via `vim.lsp`.

#### Server side (TypeScript)

Add handlers in `src/server.ts`:

```typescript
// Custom notification: client sends connection details
connection.onNotification("plsql/connect", (params: { connectionString: string }) => {
  // Store connection, query data dictionary, etc.
});

// Custom request: client asks for object info
connection.onRequest("plsql/describeObject", (params: { name: string }) => {
  // Look up object in catalog cache and return metadata
  return { type: "TABLE", columns: [] };
});
```

#### Plugin side (Lua)

Send notifications and requests from the plugin:

```lua
-- Send a notification (fire-and-forget)
require("plsql.lsp").notify("plsql/connect", {
  connectionString = "user/pass@host:1521/service",
})

-- Send a request (with response callback)
require("plsql.lsp").request("plsql/describeObject", { name = "EMPLOYEES" }, bufnr, function(err, result)
  if err then
    vim.notify("Error: " .. err.message, vim.log.levels.ERROR)
    return
  end
  -- Use result.type, result.columns, etc.
  vim.print(result)
end)
```

#### Custom notification flow

The server can also push notifications to the client:

```typescript
// Server pushes status updates
connection.sendNotification("plsql/status", { connected: true, schema: "HR" });
```

Handle them in the plugin:

```lua
vim.api.nvim_create_autocmd("LspAttach", {
  callback = function(ev)
    local client = vim.lsp.get_client_by_id(ev.data.client_id)
    if not client or client.name ~= "plsql-lsp" then
      return
    end

    -- Register handler for server-initiated notifications
    client.handlers["plsql/status"] = function(_err, params)
      vim.notify(string.format("PL/SQL: %s @ %s", params.connected and "connected" or "disconnected", params.schema))
    end
  end,
})
```

## Configuration

Project settings live in the `.dbtools/` directory at the project root. Database connections are provided by the editor plugin via LSP custom notifications — no credentials are stored in config files.

### `.dbtools/project.config.json`

The LSP reads the default connection name and schema list from this file (standard SQLcl/dbtools project config):

```json
{
  "project": "my_project",
  "sqlcl": {
    "connectionName": "my_project_dev",
    "autoConnect": false
  },
  "schemas": ["MY_SCHEMA"]
}
```

The server uses `sqlcl.connectionName` to auto-connect on startup, and `schemas` to scope catalog queries.

### `.dbtools/project.sqlformat.xml`

SQL formatting rules follow the SQLcl format. The LSP reads this file and applies the rules when formatting documents:

```xml
<options>
    <kwCase>oracle.dbtools.app.Format.Case.lower</kwCase>
    <idCase>oracle.dbtools.app.Format.Case.lower</idCase>
    <identSpaces>4</identSpaces>
    <useTab>false</useTab>
    <maxCharLineSize>128</maxCharLineSize>
    <breaksComma>oracle.dbtools.app.Format.Breaks.After</breaksComma>
    <spaceAfterCommas>true</spaceAfterCommas>
    <breaksAfterSelect>true</breaksAfterSelect>
    <alignTabColAliases>true</alignTabColAliases>
    <alignAssignments>false</alignAssignments>
    <alignTypeDecl>true</alignTypeDecl>
    <alignNamedArgs>true</alignNamedArgs>
    <spaceAroundOperators>true</spaceAroundOperators>
</options>
```

Supported `kwCase`/`idCase` values: `upper`, `lower`, `INIT_CAP` (treated as preserve). Quoted identifiers are never modified.

### Diagnostic severity

Diagnostic severity is configurable per workspace via LSP settings:

| Setting | Controls | Default |
|---------|----------|---------|
| `diagnostics.unknownTableSeverity` | "table X does not exist" | `warning` |
| `diagnostics.unknownColumnSeverity` | "column Y not in table Z" | `warning` |
| `diagnostics.unusedVariableSeverity` | unused variable/parameter hints | `hint` |

Values: `error`, `warning`, `info`, `hint`, `off` (disables the diagnostic).

## License

MIT
