import { describe, it, expect } from "vitest";
import { parseCSV, CatalogProvider } from "../src/catalogProvider";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function providerWithCache(): CatalogProvider {
  const provider = new CatalogProvider("nonexistent");
  (provider as any).cache = {
    tables: new Map([
      ["EMPLOYEES", {
        tableName: "EMPLOYEES",
        columns: [
          { columnName: "EMPLOYEE_ID", dataType: "NUMBER", nullable: false, tableName: "EMPLOYEES" },
          { columnName: "FIRST_NAME", dataType: "VARCHAR2", dataLength: 50, nullable: true, tableName: "EMPLOYEES" },
        ],
      }],
      ["DEPARTMENTS", {
        tableName: "DEPARTMENTS",
        columns: [
          { columnName: "DEPT_ID", dataType: "NUMBER", nullable: false, tableName: "DEPARTMENTS" },
        ],
      }],
    ]),
    objects: new Map([
      ["EMPLOYEE_PKG", { objectName: "EMPLOYEE_PKG", objectType: "PACKAGE", status: "VALID" }],
      ["ADD_EMPLOYEE", { objectName: "ADD_EMPLOYEE", objectType: "PROCEDURE", status: "VALID" }],
    ]),
    arguments: new Map([
      ["EMPLOYEE_PKG.ADD_EMPLOYEE", [
        { objectName: "ADD_EMPLOYEE", packageName: "EMPLOYEE_PKG", argumentName: "P_ID", position: 1, dataType: "NUMBER", inOut: "IN" },
        { objectName: "ADD_EMPLOYEE", packageName: "EMPLOYEE_PKG", argumentName: "P_NAME", position: 2, dataType: "VARCHAR2", inOut: "IN" },
      ]],
      ["ADD_EMPLOYEE", [
        { objectName: "ADD_EMPLOYEE", argumentName: "P_EMP_ID", position: 1, dataType: "NUMBER", inOut: "IN" },
      ]],
    ]),
    source: new Map(),
    lastRefreshed: Date.now(),
  };
  (provider as any)._connected = true;
  return provider;
}

// ─── 1. parseCSV ──────────────────────────────────────────────────────────────

describe("parseCSV", () => {
  it("parses basic CSV with quoted headers and values", () => {
    const csv = `"TABLE_NAME","COLUMN_NAME"\n"EMPLOYEES","EMPLOYEE_ID"\n"EMPLOYEES","FIRST_NAME"`;
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(["TABLE_NAME", "COLUMN_NAME"]);
    expect(rows[1]).toEqual(["EMPLOYEES", "EMPLOYEE_ID"]);
    expect(rows[2]).toEqual(["EMPLOYEES", "FIRST_NAME"]);
  });

  it("parses CSV with empty fields", () => {
    const csv = `"NAME","NULLABLE"\n"ID","N"\n"",""`;
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toEqual(["", ""]);
  });

  it("parses escaped double-quotes inside quoted fields", () => {
    const csv = `"COL","COMMENT"\n"X","He said ""hello"""`;
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe(`He said "hello"`);
  });

  it("parses unquoted CSV values", () => {
    const csv = `TABLE_NAME,COLUMN_NAME\nEMPLOYEES,ID`;
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["TABLE_NAME", "COLUMN_NAME"]);
    expect(rows[1]).toEqual(["EMPLOYEES", "ID"]);
  });

  it("returns empty array for empty string input", () => {
    expect(parseCSV("")).toEqual([]);
  });

  it("returns one row for a single header row with no data rows", () => {
    const rows = parseCSV(`"TABLE_NAME","COLUMN_NAME"`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(["TABLE_NAME", "COLUMN_NAME"]);
  });

  it("ignores trailing newlines", () => {
    const csv = `"TABLE_NAME","COLUMN_NAME"\n"EMPLOYEES","ID"\n\n\n`;
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(2);
  });

  it("handles SQLcl output format with trailing summary line", () => {
    const csv = `"OBJECT_TYPE","CNT"\n"INDEX",3\n"PACKAGE",3\n"TABLE",2\n\n6 rows selected. \n`;
    const rows = parseCSV(csv);
    // The header row plus the 3 data rows plus the trailing summary line
    // (blank lines are skipped; the summary line is kept as a regular row)
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual(["OBJECT_TYPE", "CNT"]);
    expect(rows[1]).toEqual(["INDEX", "3"]);
    expect(rows[2]).toEqual(["PACKAGE", "3"]);
    expect(rows[3]).toEqual(["TABLE", "2"]);
    // The summary line has a different column count — consumers skip the header
    // and ignore rows that do not match the expected column count
    expect(rows[4][0]).toBe("6 rows selected.");
  });
});

// ─── 2. CatalogProvider — empty cache (no process) ───────────────────────────

describe("CatalogProvider with no cache", () => {
  it("getTables() returns empty array before connection", () => {
    const provider = new CatalogProvider("nonexistent");
    expect(provider.getTables()).toEqual([]);
  });

  it("getTable() returns undefined before connection", () => {
    const provider = new CatalogProvider("nonexistent");
    expect(provider.getTable("X")).toBeUndefined();
  });

  it("getColumns() returns empty array before connection", () => {
    const provider = new CatalogProvider("nonexistent");
    expect(provider.getColumns("X")).toEqual([]);
  });

  it("getObject() returns undefined before connection", () => {
    const provider = new CatalogProvider("nonexistent");
    expect(provider.getObject("X")).toBeUndefined();
  });

  it("getObjects() returns empty array before connection", () => {
    const provider = new CatalogProvider("nonexistent");
    expect(provider.getObjects()).toEqual([]);
  });

  it("getArguments() returns empty array before connection", () => {
    const provider = new CatalogProvider("nonexistent");
    expect(provider.getArguments("X")).toEqual([]);
  });

  it("isConnected is false initially", () => {
    const provider = new CatalogProvider("nonexistent");
    expect(provider.isConnected).toBe(false);
  });
});

// ─── 3. CatalogProvider — accessors with populated cache ─────────────────────

describe("CatalogProvider with populated cache", () => {
  it("getTables() returns all tables", () => {
    const provider = providerWithCache();
    const tables = provider.getTables();
    expect(tables).toHaveLength(2);
    const names = tables.map((t) => t.tableName);
    expect(names).toContain("EMPLOYEES");
    expect(names).toContain("DEPARTMENTS");
  });

  it("getTable() is case-insensitive and finds EMPLOYEES by lowercase key", () => {
    const provider = providerWithCache();
    const table = provider.getTable("employees");
    expect(table).toBeDefined();
    expect(table!.tableName).toBe("EMPLOYEES");
  });

  it("getTable() returns undefined for a non-existent table name", () => {
    const provider = providerWithCache();
    expect(provider.getTable("NONEXISTENT")).toBeUndefined();
  });

  it("getColumns() returns all columns for a table", () => {
    const provider = providerWithCache();
    const columns = provider.getColumns("employees");
    expect(columns).toHaveLength(2);
    const names = columns.map((c) => c.columnName);
    expect(names).toContain("EMPLOYEE_ID");
    expect(names).toContain("FIRST_NAME");
  });

  it("getColumns() returns empty array for a non-existent table", () => {
    const provider = providerWithCache();
    expect(provider.getColumns("nonexistent")).toEqual([]);
  });

  it("getObject() is case-insensitive and finds the package", () => {
    const provider = providerWithCache();
    const obj = provider.getObject("employee_pkg");
    expect(obj).toBeDefined();
    expect(obj!.objectName).toBe("EMPLOYEE_PKG");
    expect(obj!.objectType).toBe("PACKAGE");
  });

  it("getObjects() filtered by type returns only matching objects", () => {
    const provider = providerWithCache();
    const packages = provider.getObjects("PACKAGE");
    expect(packages).toHaveLength(1);
    expect(packages[0].objectName).toBe("EMPLOYEE_PKG");
  });

  it("getObjects() with no filter returns all objects", () => {
    const provider = providerWithCache();
    const all = provider.getObjects();
    expect(all).toHaveLength(2);
    const names = all.map((o) => o.objectName);
    expect(names).toContain("EMPLOYEE_PKG");
    expect(names).toContain("ADD_EMPLOYEE");
  });

  it("getArguments() with packageName returns arguments for the package-qualified procedure", () => {
    const provider = providerWithCache();
    const args = provider.getArguments("ADD_EMPLOYEE", "EMPLOYEE_PKG");
    expect(args).toHaveLength(2);
    expect(args[0].argumentName).toBe("P_ID");
    expect(args[1].argumentName).toBe("P_NAME");
  });

  it("getArguments() without packageName returns arguments for the standalone procedure", () => {
    const provider = providerWithCache();
    const args = provider.getArguments("ADD_EMPLOYEE");
    expect(args).toHaveLength(1);
    expect(args[0].argumentName).toBe("P_EMP_ID");
  });

  it("getArguments() returns empty array for an unknown object", () => {
    const provider = providerWithCache();
    expect(provider.getArguments("NONEXISTENT")).toEqual([]);
  });

  it("isConnected is true after cache is populated", () => {
    const provider = providerWithCache();
    expect(provider.isConnected).toBe(true);
  });
});
