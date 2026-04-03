import { describe, it, expect } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { parseDocument } from "../src/parser/index";
import { getCatalogDiagnostics } from "../src/catalogDiagnostics";
import { CatalogProvider } from "../src/catalogProvider";
import { CatalogCache } from "../src/catalogTypes";

// ─── Mock catalog factory ─────────────────────────────────────────────────────

function createMockCatalog(): CatalogProvider {
  const provider = new CatalogProvider("nonexistent");
  (provider as any)._connected = true;
  (provider as any).cache = {
    tables: new Map([
      [
        "EMPLOYEES",
        {
          tableName: "EMPLOYEES",
          columns: [
            {
              columnName: "EMPLOYEE_ID",
              dataType: "NUMBER",
              dataPrecision: 10,
              nullable: false,
              tableName: "EMPLOYEES",
            },
            {
              columnName: "FIRST_NAME",
              dataType: "VARCHAR2",
              dataLength: 50,
              nullable: true,
              tableName: "EMPLOYEES",
            },
            {
              columnName: "LAST_NAME",
              dataType: "VARCHAR2",
              dataLength: 50,
              nullable: true,
              tableName: "EMPLOYEES",
            },
            {
              columnName: "SALARY",
              dataType: "NUMBER",
              dataPrecision: 10,
              dataScale: 2,
              nullable: true,
              tableName: "EMPLOYEES",
            },
          ],
        },
      ],
      [
        "DEPARTMENTS",
        {
          tableName: "DEPARTMENTS",
          columns: [
            {
              columnName: "DEPT_ID",
              dataType: "NUMBER",
              nullable: false,
              tableName: "DEPARTMENTS",
            },
            {
              columnName: "DEPT_NAME",
              dataType: "VARCHAR2",
              dataLength: 100,
              nullable: true,
              tableName: "DEPARTMENTS",
            },
          ],
        },
      ],
    ]),
    objects: new Map(),
    arguments: new Map(),
    source: new Map(),
    lastRefreshed: Date.now(),
  } as CatalogCache;
  return provider;
}

// ─── Test helper ─────────────────────────────────────────────────────────────

function diag(sql: string, catalog?: CatalogProvider) {
  const { ast } = parseDocument(sql);
  return getCatalogDiagnostics(ast, sql, catalog);
}

// ─── 1. No diagnostics when catalog not connected ─────────────────────────────

describe("No diagnostics when catalog not connected", () => {
  it("returns empty array when no catalog is passed", () => {
    const results = diag("SELECT * FROM unknown_table");
    expect(results).toEqual([]);
  });

  it("returns empty array when catalog is disconnected", () => {
    const disconnected = new CatalogProvider("nonexistent");
    // _connected defaults to false, cache is null
    const results = diag("SELECT * FROM unknown_table", disconnected);
    expect(results).toEqual([]);
  });
});

// ─── 2. Known table produces no diagnostics ───────────────────────────────────

describe("Known table produces no diagnostics", () => {
  it("SELECT * FROM employees (lowercase) produces no diagnostics", () => {
    const catalog = createMockCatalog();
    expect(diag("SELECT * FROM employees", catalog)).toEqual([]);
  });

  it("SELECT * FROM EMPLOYEES (uppercase) produces no diagnostics", () => {
    const catalog = createMockCatalog();
    expect(diag("SELECT * FROM EMPLOYEES", catalog)).toEqual([]);
  });

  it("SELECT * FROM employees, departments produces no diagnostics for either known table", () => {
    const catalog = createMockCatalog();
    expect(diag("SELECT * FROM employees, departments", catalog)).toEqual([]);
  });
});

// ─── 3. Unknown table produces warning ───────────────────────────────────────

describe("Unknown table produces warning", () => {
  it("SELECT * FROM unknown_table yields exactly 1 diagnostic", () => {
    const catalog = createMockCatalog();
    const results = diag("SELECT * FROM unknown_table", catalog);
    expect(results).toHaveLength(1);
  });

  it("diagnostic message contains 'does not exist'", () => {
    const catalog = createMockCatalog();
    const [d] = diag("SELECT * FROM unknown_table", catalog);
    expect(d.message).toContain("does not exist");
  });

  it("diagnostic message contains the table name", () => {
    const catalog = createMockCatalog();
    const [d] = diag("SELECT * FROM unknown_table", catalog);
    expect(d.message.toLowerCase()).toContain("unknown_table");
  });

  it("diagnostic severity is Warning", () => {
    const catalog = createMockCatalog();
    const [d] = diag("SELECT * FROM unknown_table", catalog);
    expect(d.severity).toBe(DiagnosticSeverity.Warning);
  });

  it("diagnostic source is 'plsql-lsp(catalog)'", () => {
    const catalog = createMockCatalog();
    const [d] = diag("SELECT * FROM unknown_table", catalog);
    expect(d.source).toBe("plsql-lsp(catalog)");
  });
});

// ─── 4. Mixed known and unknown tables ───────────────────────────────────────

describe("Mixed known and unknown tables", () => {
  it("SELECT * FROM employees, unknown_tbl yields 1 diagnostic for unknown_tbl only", () => {
    const catalog = createMockCatalog();
    const results = diag("SELECT * FROM employees, unknown_tbl", catalog);
    expect(results).toHaveLength(1);
    expect(results[0].message.toLowerCase()).toContain("unknown_tbl");
  });

  it("diagnostic is not about the known employees table", () => {
    const catalog = createMockCatalog();
    const [d] = diag("SELECT * FROM employees, unknown_tbl", catalog);
    expect(d.message.toLowerCase()).not.toContain("employees");
  });
});

// ─── 5. Column exists — no diagnostic ────────────────────────────────────────

describe("Column exists — no diagnostic", () => {
  it("SELECT emp.employee_id FROM employees emp (alias + known column) produces no diagnostics", () => {
    const catalog = createMockCatalog();
    expect(diag("SELECT emp.employee_id FROM employees emp", catalog)).toEqual([]);
  });

  it("SELECT employees.first_name FROM employees (direct table ref + known column) produces no diagnostics", () => {
    const catalog = createMockCatalog();
    expect(
      diag("SELECT employees.first_name FROM employees", catalog),
    ).toEqual([]);
  });
});

// ─── 6. Unknown column produces warning ──────────────────────────────────────

describe("Unknown column produces warning", () => {
  it("SELECT emp.nonexistent FROM employees emp yields 1 diagnostic", () => {
    const catalog = createMockCatalog();
    const results = diag("SELECT emp.nonexistent FROM employees emp", catalog);
    expect(results).toHaveLength(1);
  });

  it("diagnostic message mentions the column name", () => {
    const catalog = createMockCatalog();
    const [d] = diag("SELECT emp.nonexistent FROM employees emp", catalog);
    expect(d.message.toLowerCase()).toContain("nonexistent");
  });

  it("diagnostic message mentions the table name", () => {
    const catalog = createMockCatalog();
    const [d] = diag("SELECT emp.nonexistent FROM employees emp", catalog);
    expect(d.message.toUpperCase()).toContain("EMPLOYEES");
  });

  it("diagnostic severity is Warning", () => {
    const catalog = createMockCatalog();
    const [d] = diag("SELECT emp.nonexistent FROM employees emp", catalog);
    expect(d.severity).toBe(DiagnosticSeverity.Warning);
  });

  it("diagnostic source is 'plsql-lsp(catalog)'", () => {
    const catalog = createMockCatalog();
    const [d] = diag("SELECT emp.nonexistent FROM employees emp", catalog);
    expect(d.source).toBe("plsql-lsp(catalog)");
  });
});

// ─── 7. Column check with table alias ────────────────────────────────────────

describe("Column check with table alias", () => {
  it("SELECT emp.employee_id, emp.unknown_col FROM employees emp yields 1 diagnostic for unknown_col", () => {
    const catalog = createMockCatalog();
    const results = diag(
      "SELECT emp.employee_id, emp.unknown_col FROM employees emp",
      catalog,
    );
    expect(results).toHaveLength(1);
    expect(results[0].message.toLowerCase()).toContain("unknown_col");
  });

  it("no diagnostic is produced for the valid employee_id column when another column is invalid", () => {
    const catalog = createMockCatalog();
    const results = diag(
      "SELECT emp.employee_id, emp.unknown_col FROM employees emp",
      catalog,
    );
    expect(results.every((d) => !d.message.toLowerCase().includes("employee_id"))).toBe(true);
  });
});

// ─── 8. No column diagnostic when table is unknown ───────────────────────────

describe("No column diagnostic when table is unknown", () => {
  it("SELECT x.col FROM unknown_table x yields only the table diagnostic, not a column diagnostic", () => {
    const catalog = createMockCatalog();
    const results = diag("SELECT x.col FROM unknown_table x", catalog);
    // Only 1 diagnostic — for the unknown table, not the column
    expect(results).toHaveLength(1);
    expect(results[0].message.toLowerCase()).toContain("unknown_table");
    expect(results[0].message.toLowerCase()).not.toContain("col");
  });
});

// ─── 9. Multiple diagnostic support ──────────────────────────────────────────

describe("Multiple diagnostic support", () => {
  it("SQL with 2 unknown tables yields 2 diagnostics", () => {
    const catalog = createMockCatalog();
    const results = diag(
      "SELECT * FROM ghost_table, phantom_table",
      catalog,
    );
    expect(results).toHaveLength(2);
  });

  it("each diagnostic from 2 unknown tables identifies its respective table", () => {
    const catalog = createMockCatalog();
    const results = diag(
      "SELECT * FROM ghost_table, phantom_table",
      catalog,
    );
    const messages = results.map((d) => d.message.toLowerCase());
    expect(messages.some((m) => m.includes("ghost_table"))).toBe(true);
    expect(messages.some((m) => m.includes("phantom_table"))).toBe(true);
  });

  it("unknown table + unknown column on known table yields 2 diagnostics", () => {
    const catalog = createMockCatalog();
    // ghost_table is unknown -> 1 table diagnostic
    // emp.bad_col references employees via alias emp -> 1 column diagnostic
    const results = diag(
      "SELECT emp.bad_col FROM employees emp, ghost_table",
      catalog,
    );
    expect(results).toHaveLength(2);
  });

  it("one diagnostic is for the unknown table, one is for the unknown column", () => {
    const catalog = createMockCatalog();
    const results = diag(
      "SELECT emp.bad_col FROM employees emp, ghost_table",
      catalog,
    );
    const messages = results.map((d) => d.message.toLowerCase());
    expect(messages.some((m) => m.includes("ghost_table"))).toBe(true);
    expect(messages.some((m) => m.includes("bad_col"))).toBe(true);
  });
});

// ─── 10. PL/SQL context with DML ─────────────────────────────────────────────

describe("PL/SQL context with DML", () => {
  it("SELECT into a variable from a known table inside a procedure produces no diagnostics", () => {
    const catalog = createMockCatalog();
    const sql =
      "CREATE PROCEDURE p AS BEGIN SELECT employee_id INTO v_id FROM employees; END;";
    expect(diag(sql, catalog)).toEqual([]);
  });

  it("SELECT from a nonexistent table inside a procedure yields 1 diagnostic", () => {
    const catalog = createMockCatalog();
    const sql =
      "CREATE PROCEDURE p AS BEGIN SELECT * FROM nonexistent; END;";
    const results = diag(sql, catalog);
    expect(results).toHaveLength(1);
    expect(results[0].message.toLowerCase()).toContain("nonexistent");
  });
});

// ─── 11. Schema-qualified two-dot chain diagnostics ──────────────────────────

describe("Schema-qualified two-dot chain diagnostics", () => {
  it("schema.table.known_column produces no diagnostic", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT HR.employees.employee_id FROM employees";
    expect(diag(sql, catalog)).toEqual([]);
  });

  it("schema.table.unknown_column produces a warning for the column", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT HR.employees.nonexistent FROM employees";
    const results = diag(sql, catalog);
    const colDiags = results.filter((d) => d.message.toLowerCase().includes("nonexistent"));
    expect(colDiags).toHaveLength(1);
    expect(colDiags[0].severity).toBe(DiagnosticSeverity.Warning);
  });

  it("schema.table.unknown_column diagnostic mentions the table name", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT HR.employees.bad_col FROM employees";
    const results = diag(sql, catalog);
    const colDiags = results.filter((d) => d.message.toLowerCase().includes("bad_col"));
    expect(colDiags).toHaveLength(1);
    expect(colDiags[0].message.toUpperCase()).toContain("EMPLOYEES");
  });

  it("schema.table.known_column works with multiple valid columns", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT HR.employees.employee_id, HR.employees.first_name FROM employees";
    expect(diag(sql, catalog)).toEqual([]);
  });
});

// ─── 12. Diagnostic range covers the correct token ───────────────────────────

describe("Diagnostic range covers the correct token", () => {
  it("range start and end positions are valid objects with line and character", () => {
    const catalog = createMockCatalog();
    const [d] = diag("SELECT * FROM xyz", catalog);
    expect(d.range.start).toHaveProperty("line");
    expect(d.range.start).toHaveProperty("character");
    expect(d.range.end).toHaveProperty("line");
    expect(d.range.end).toHaveProperty("character");
  });

  it("range covers exactly 3 characters for the 3-letter table name 'xyz'", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT * FROM xyz";
    const [d] = diag(sql, catalog);
    // Both start and end are on line 0 (single-line input)
    expect(d.range.start.line).toBe(0);
    expect(d.range.end.line).toBe(0);
    // The span length equals the length of "xyz" (3 characters)
    const span = d.range.end.character - d.range.start.character;
    expect(span).toBe(3);
  });

  it("range start character points to where 'xyz' begins in the source text", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT * FROM xyz";
    const [d] = diag(sql, catalog);
    // "SELECT * FROM " is 14 characters, so 'xyz' starts at character 14
    expect(d.range.start.character).toBe(14);
  });

  it("range end character points to one past the last character of 'xyz'", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT * FROM xyz";
    const [d] = diag(sql, catalog);
    expect(d.range.end.character).toBe(17);
  });

  it("range for unknown table on a second line has correct line number", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT *\nFROM bad_tbl";
    const [d] = diag(sql, catalog);
    // "bad_tbl" is on line index 1
    expect(d.range.start.line).toBe(1);
    expect(d.range.end.line).toBe(1);
  });
});
