import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";
import { getHover } from "../src/hover";
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
    objects: new Map([
      [
        "EMPLOYEE_PKG",
        { objectName: "EMPLOYEE_PKG", objectType: "PACKAGE", status: "VALID" },
      ],
      [
        "ADD_EMPLOYEE",
        {
          objectName: "ADD_EMPLOYEE",
          objectType: "PROCEDURE",
          status: "VALID",
        },
      ],
      [
        "GET_NAME",
        { objectName: "GET_NAME", objectType: "FUNCTION", status: "VALID" },
      ],
      [
        "CALC_SALARY",
        { objectName: "CALC_SALARY", objectType: "FUNCTION", status: "VALID" },
      ],
      [
        "EMP_SEQ",
        { objectName: "EMP_SEQ", objectType: "SEQUENCE", status: "VALID" },
      ],
    ]),
    arguments: new Map([
      [
        "EMPLOYEE_PKG.ADD_EMPLOYEE",
        [
          {
            objectName: "ADD_EMPLOYEE",
            packageName: "EMPLOYEE_PKG",
            argumentName: "P_ID",
            position: 1,
            dataType: "NUMBER",
            inOut: "IN",
          },
          {
            objectName: "ADD_EMPLOYEE",
            packageName: "EMPLOYEE_PKG",
            argumentName: "P_NAME",
            position: 2,
            dataType: "VARCHAR2",
            inOut: "IN",
          },
        ],
      ],
      [
        "EMPLOYEE_PKG.GET_NAME",
        [
          {
            objectName: "GET_NAME",
            packageName: "EMPLOYEE_PKG",
            argumentName: "P_ID",
            position: 1,
            dataType: "NUMBER",
            inOut: "IN",
          },
        ],
      ],
    ]),
    source: new Map(),
    lastRefreshed: Date.now(),
  } as CatalogCache;
  return provider;
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function hover(
  sql: string,
  catalog?: CatalogProvider,
  marker = "/*|*/",
) {
  const pos = sql.indexOf(marker);
  if (pos === -1) throw new Error("marker not found in sql");
  const text = sql.replace(marker, "");
  const { ast } = parseDocument(text);
  return getHover(ast, text, pos, catalog);
}

function hoverContent(
  sql: string,
  catalog?: CatalogProvider,
  marker = "/*|*/",
): string {
  const result = hover(sql, catalog, marker);
  if (!result) return "";
  return typeof result.contents === "string"
    ? result.contents
    : "value" in result.contents
      ? result.contents.value
      : "";
}

// ─── 1. Hover on table name ───────────────────────────────────────────────────

describe("Hover on table name", () => {
  const sql = "SELECT * FROM employ/*|*/ees";

  it("result is not null", () => {
    expect(hover(sql, createMockCatalog())).not.toBeNull();
  });

  it("content contains TABLE EMPLOYEES", () => {
    expect(hoverContent(sql, createMockCatalog())).toContain(
      "TABLE EMPLOYEES",
    );
  });

  it("content contains the (table) label", () => {
    expect(hoverContent(sql, createMockCatalog())).toContain("(table)");
  });

  it("content lists the column names", () => {
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("EMPLOYEE_ID");
    expect(content).toContain("FIRST_NAME");
    expect(content).toContain("SALARY");
  });

  it("content lists column types alongside names", () => {
    const content = hoverContent(sql, createMockCatalog());
    // formatColumnType produces NUMBER(10) for EMPLOYEE_ID
    expect(content).toContain("NUMBER(10)");
    // formatColumnType produces VARCHAR2(50) for FIRST_NAME
    expect(content).toContain("VARCHAR2(50)");
  });

  it("DEPARTMENTS table hover contains DEPARTMENTS", () => {
    const deptSql = "SELECT * FROM departme/*|*/nts";
    expect(hoverContent(deptSql, createMockCatalog())).toContain(
      "TABLE DEPARTMENTS",
    );
  });
});

// ─── 2. Hover on table.column ────────────────────────────────────────────────

describe("Hover on table.column", () => {
  it("hovering on EMPLOYEE_ID in employees.EMPLOYEE_ID shows column info", () => {
    const sql = "SELECT employees.EMPLOYEE/*|*/_ID FROM employees";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("EMPLOYEE_ID");
  });

  it("content contains the column type NUMBER(10)", () => {
    const sql = "SELECT employees.EMPLOYEE/*|*/_ID FROM employees";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("NUMBER(10)");
  });

  it("content contains NOT NULL for non-nullable column", () => {
    const sql = "SELECT employees.EMPLOYEE/*|*/_ID FROM employees";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("NOT NULL");
  });

  it("content contains NULL for nullable column", () => {
    const sql = "SELECT employees.FIRST/*|*/_NAME FROM employees";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("NULL");
  });

  it("content contains the (column) label", () => {
    const sql = "SELECT employees.EMPLOYEE/*|*/_ID FROM employees";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("(column)");
  });

  it("content references the parent table name", () => {
    const sql = "SELECT employees.EMPLOYEE/*|*/_ID FROM employees";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("EMPLOYEES");
  });

  it("SALARY hover shows NUMBER(10,2) for precision and scale", () => {
    const sql = "SELECT employees.SAL/*|*/ARY FROM employees";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("NUMBER(10,2)");
  });

  it("DEPT_NAME hover shows VARCHAR2(100)", () => {
    const sql = "SELECT departments.DEPT/*|*/_NAME FROM departments";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("VARCHAR2(100)");
  });
});

// ─── 3. Hover on package name ─────────────────────────────────────────────────

describe("Hover on package name", () => {
  it("result is not null", () => {
    const sql = "BEGIN EMPLOYEE/*|*/_PKG.add_employee; END;";
    expect(hover(sql, createMockCatalog())).not.toBeNull();
  });

  it("content contains PACKAGE EMPLOYEE_PKG", () => {
    const sql = "BEGIN EMPLOYEE/*|*/_PKG.add_employee; END;";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("PACKAGE EMPLOYEE_PKG");
  });

  it("content contains the (package) label", () => {
    const sql = "BEGIN EMPLOYEE/*|*/_PKG.add_employee; END;";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("(package)");
  });

  it("content contains the object status VALID", () => {
    const sql = "BEGIN EMPLOYEE/*|*/_PKG.add_employee; END;";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("VALID");
  });
});

// ─── 4. Hover on package member ──────────────────────────────────────────────

describe("Hover on package member", () => {
  it("result is not null for ADD_EMPLOYEE in EMPLOYEE_PKG.ADD_EMPLOYEE", () => {
    const sql = "BEGIN EMPLOYEE_PKG.ADD_EMPLOYEE/*|*/; END;";
    expect(hover(sql, createMockCatalog())).not.toBeNull();
  });

  it("content contains EMPLOYEE_PKG.ADD_EMPLOYEE", () => {
    const sql = "BEGIN EMPLOYEE_PKG.ADD_EMPLOYEE/*|*/; END;";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("EMPLOYEE_PKG.ADD_EMPLOYEE");
  });

  it("content contains the (package member) label", () => {
    const sql = "BEGIN EMPLOYEE_PKG.ADD_EMPLOYEE/*|*/; END;";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("(package member)");
  });

  it("content contains the argument P_ID", () => {
    const sql = "BEGIN EMPLOYEE_PKG.ADD_EMPLOYEE/*|*/; END;";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("P_ID");
  });

  it("content contains the argument P_NAME", () => {
    const sql = "BEGIN EMPLOYEE_PKG.ADD_EMPLOYEE/*|*/; END;";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("P_NAME");
  });

  it("GET_NAME member hover shows its P_ID argument", () => {
    const sql = "BEGIN EMPLOYEE_PKG.GET_NAME/*|*/; END;";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("P_ID");
    expect(content).toContain("EMPLOYEE_PKG.GET_NAME");
  });

  it("argument list includes IN and data types", () => {
    const sql = "BEGIN EMPLOYEE_PKG.ADD_EMPLOYEE/*|*/; END;";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("IN");
    expect(content).toContain("NUMBER");
    expect(content).toContain("VARCHAR2");
  });
});

// ─── 5. Hover with schema-qualified two-dot chains ────────────────────────────

describe("Hover with schema-qualified two-dot chains", () => {
  it("hovering on column in schema.table.column shows column info", () => {
    const sql = "SELECT HR.employees.EMPLOYEE/*|*/_ID FROM employees";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("EMPLOYEE_ID");
    expect(content).toContain("NUMBER(10)");
    expect(content).toContain("(column)");
  });

  it("hovering on SALARY in schema.table.SALARY shows type", () => {
    const sql = "SELECT HR.employees.SAL/*|*/ARY FROM employees";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("SALARY");
    expect(content).toContain("NUMBER(10,2)");
  });

  it("hovering on package member in schema.pkg.member shows member info", () => {
    const sql = "BEGIN HR.EMPLOYEE_PKG.ADD_EMPLOYEE/*|*/; END;";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("EMPLOYEE_PKG.ADD_EMPLOYEE");
    expect(content).toContain("(package member)");
    expect(content).toContain("P_ID");
  });

  it("hovering on table name in schema.table.column shows table info", () => {
    const sql = "SELECT HR.employ/*|*/ees.employee_id FROM employees";
    const content = hoverContent(sql, createMockCatalog());
    // Hovering on 'employees' should show table info (via fallthrough to standalone check)
    expect(content).toContain("TABLE EMPLOYEES");
  });

  it("hovering on GET_NAME in schema.pkg.GET_NAME shows argument info", () => {
    const sql = "BEGIN HR.EMPLOYEE_PKG.GET_NAME/*|*/; END;";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("GET_NAME");
    expect(content).toContain("P_ID");
  });
});

// ─── 6. No catalog hover when not connected ───────────────────────────────────

describe("No catalog hover when not connected", () => {
  it("hovering on EMPLOYEES with no catalog returns null", () => {
    const sql = "SELECT * FROM employ/*|*/ees";
    expect(hover(sql, undefined)).toBeNull();
  });

  it("hovering on EMPLOYEE_PKG with no catalog returns null", () => {
    const sql = "BEGIN EMPLOYEE/*|*/_PKG.foo; END;";
    expect(hover(sql, undefined)).toBeNull();
  });

  it("hovering on EMPLOYEE_ID in dot notation with no catalog returns null", () => {
    const sql = "SELECT employees.EMPLOYEE/*|*/_ID FROM employees";
    expect(hover(sql, undefined)).toBeNull();
  });

  it("disconnected catalog returns null for table name", () => {
    const catalog = new CatalogProvider("nonexistent");
    // _connected defaults to false
    const sql = "SELECT * FROM employ/*|*/ees";
    expect(hover(sql, catalog)).toBeNull();
  });

  it("no catalog hover still works for local symbols", () => {
    // A local variable should resolve via symbol table even without catalog
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; BEGIN v_cou/*|*/nt := 1; END;";
    const result = hover(sql, undefined);
    expect(result).not.toBeNull();
    const content =
      result && "value" in result.contents ? result.contents.value : "";
    expect(content).toContain("v_count");
  });
});

// ─── 6. Local symbols take priority over catalog ──────────────────────────────

describe("Local symbols take priority over catalog", () => {
  it("hovering on a local variable named employees shows the variable, not the table", () => {
    // Declare a local variable named "employees" — it shadows the catalog table
    const sql =
      "CREATE PROCEDURE p AS employees NUMBER; BEGIN employ/*|*/ees := 1; END;";
    const content = hoverContent(sql, createMockCatalog());
    // Should show the local variable info (variable label, NUMBER type)
    expect(content).toContain("(variable)");
    expect(content).toContain("NUMBER");
    // Should NOT show table info
    expect(content).not.toContain("(table)");
    expect(content).not.toContain("Columns:");
  });

  it("hover result is not null for a local variable shadowing a catalog table", () => {
    const sql =
      "CREATE PROCEDURE p AS employees NUMBER; BEGIN employ/*|*/ees := 1; END;";
    expect(hover(sql, createMockCatalog())).not.toBeNull();
  });

  it("hovering on a local parameter named EMPLOYEE_PKG shows parameter, not package", () => {
    const sql =
      "CREATE PROCEDURE p (employee_pkg IN NUMBER) AS BEGIN employee_p/*|*/kg := 1; END;";
    const content = hoverContent(sql, createMockCatalog());
    expect(content).toContain("(parameter)");
    expect(content).not.toContain("(package)");
  });
});

// ─── 7. Hover range is correct for catalog items ─────────────────────────────

describe("Hover range is correct for catalog items", () => {
  it("hover on table name has a defined range", () => {
    const sql = "SELECT * FROM employ/*|*/ees";
    const result = hover(sql, createMockCatalog());
    expect(result).not.toBeNull();
    expect(result!.range).toBeDefined();
  });

  it("range start and end are on the same line for single-line table name", () => {
    const sql = "SELECT * FROM employ/*|*/ees";
    const result = hover(sql, createMockCatalog());
    expect(result!.range!.start.line).toBe(result!.range!.end.line);
  });

  it("range covers the full identifier 'employees' (9 characters)", () => {
    const sql = "SELECT * FROM employ/*|*/ees";
    const result = hover(sql, createMockCatalog());
    const range = result!.range!;
    expect(range.end.character - range.start.character).toBe(
      "employees".length,
    );
  });

  it("hover on column name in dot notation has a defined range", () => {
    const sql = "SELECT employees.EMPLOYEE_ID/*|*/ FROM employees";
    const result = hover(sql, createMockCatalog());
    expect(result).not.toBeNull();
    expect(result!.range).toBeDefined();
  });
});
