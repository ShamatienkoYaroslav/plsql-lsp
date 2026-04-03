import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";
import { getCompletions } from "../src/completion";
import { CompletionItemKind } from "vscode-languageserver/node";
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

function complete(
  sql: string,
  catalog?: CatalogProvider,
  marker = "/*|*/",
) {
  const pos = sql.indexOf(marker);
  if (pos === -1) throw new Error("marker not found in sql");
  const text = sql.replace(marker, "");
  const { ast } = parseDocument(text);
  return getCompletions(ast, text, pos, catalog);
}

function labels(items: ReturnType<typeof complete>): string[] {
  return items.map((i) => i.label);
}

function findItem(items: ReturnType<typeof complete>, label: string) {
  return items.find((i) => i.label.toUpperCase() === label.toUpperCase());
}

// ─── 1. Table names appear in completions ─────────────────────────────────────

describe("Table names appear in completions", () => {
  it("EMPLOYEES table appears when typing FROM EMP", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT * FROM EMP/*|*/";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("EMPLOYEES");
  });

  it("DEPARTMENTS table appears when typing FROM EMP", () => {
    const catalog = createMockCatalog();
    // No prefix at cursor so all tables appear
    const sql = "SELECT * FROM /*|*/";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("DEPARTMENTS");
  });

  it("both tables appear with no prefix after FROM", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT * FROM /*|*/";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("EMPLOYEES");
    expect(labels(items)).toContain("DEPARTMENTS");
  });

  it("prefix EMP filters to only EMPLOYEES and not DEPARTMENTS", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT * FROM EMP/*|*/";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("EMPLOYEES");
    expect(labels(items)).not.toContain("DEPARTMENTS");
  });
});

// ─── 2. Table names have Struct kind ─────────────────────────────────────────

describe("Table names have Struct kind", () => {
  it("EMPLOYEES completion item has kind Struct", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT * FROM /*|*/";
    const items = complete(sql, catalog);
    expect(findItem(items, "EMPLOYEES")?.kind).toBe(CompletionItemKind.Struct);
  });

  it("DEPARTMENTS completion item has kind Struct", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT * FROM /*|*/";
    const items = complete(sql, catalog);
    expect(findItem(items, "DEPARTMENTS")?.kind).toBe(
      CompletionItemKind.Struct,
    );
  });
});

// ─── 3. Column completion after dot ──────────────────────────────────────────

describe("Column completion after dot", () => {
  it("EMPLOYEE_ID appears after employees.", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT employees./*|*/ FROM employees";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("EMPLOYEE_ID");
  });

  it("FIRST_NAME appears after employees.", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT employees./*|*/ FROM employees";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("FIRST_NAME");
  });

  it("LAST_NAME appears after employees.", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT employees./*|*/ FROM employees";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("LAST_NAME");
  });

  it("SALARY appears after employees.", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT employees./*|*/ FROM employees";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("SALARY");
  });

  it("column items have kind Field", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT employees./*|*/ FROM employees";
    const items = complete(sql, catalog);
    expect(findItem(items, "EMPLOYEE_ID")?.kind).toBe(CompletionItemKind.Field);
    expect(findItem(items, "FIRST_NAME")?.kind).toBe(CompletionItemKind.Field);
  });

  it("DEPT_ID and DEPT_NAME appear after departments.", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT departments./*|*/ FROM departments";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("DEPT_ID");
    expect(labels(items)).toContain("DEPT_NAME");
  });

  it("prefix EMP after dot filters to only EMPLOYEE_ID", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT employees.EMP/*|*/ FROM employees";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("EMPLOYEE_ID");
    expect(labels(items)).not.toContain("FIRST_NAME");
    expect(labels(items)).not.toContain("SALARY");
  });
});

// ─── 4. Column completion is case-insensitive for qualifier ──────────────────

describe("Column completion is case-insensitive for qualifier", () => {
  it("EMPLOYEE_ID appears after EMPLOYEES. (uppercase qualifier)", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT EMPLOYEES./*|*/ FROM EMPLOYEES";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("EMPLOYEE_ID");
  });

  it("FIRST_NAME appears after EMPLOYEES. (uppercase qualifier)", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT EMPLOYEES./*|*/ FROM EMPLOYEES";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("FIRST_NAME");
  });

  it("DEPT_NAME appears after DEPARTMENTS. (uppercase qualifier)", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT DEPARTMENTS./*|*/ FROM departments";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("DEPT_NAME");
  });
});

// ─── 5. Package member completion after dot ───────────────────────────────────

describe("Package member completion after dot", () => {
  it("ADD_EMPLOYEE appears after EMPLOYEE_PKG.", () => {
    const catalog = createMockCatalog();
    const sql = "BEGIN EMPLOYEE_PKG./*|*/ END;";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("ADD_EMPLOYEE");
  });

  it("GET_NAME appears after EMPLOYEE_PKG.", () => {
    const catalog = createMockCatalog();
    const sql = "BEGIN EMPLOYEE_PKG./*|*/ END;";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("GET_NAME");
  });

  it("package member items have kind Function", () => {
    const catalog = createMockCatalog();
    const sql = "BEGIN EMPLOYEE_PKG./*|*/ END;";
    const items = complete(sql, catalog);
    expect(findItem(items, "ADD_EMPLOYEE")?.kind).toBe(
      CompletionItemKind.Function,
    );
    expect(findItem(items, "GET_NAME")?.kind).toBe(CompletionItemKind.Function);
  });

  it("package member detail indicates the object type", () => {
    const catalog = createMockCatalog();
    const sql = "BEGIN EMPLOYEE_PKG./*|*/ END;";
    const items = complete(sql, catalog);
    // ADD_EMPLOYEE is a PROCEDURE so detail should be 'procedure'
    expect(findItem(items, "ADD_EMPLOYEE")?.detail).toBe("procedure");
    // GET_NAME is a FUNCTION so detail should be 'function'
    expect(findItem(items, "GET_NAME")?.detail).toBe("function");
  });

  it("DEPARTMENTS table columns do not appear after EMPLOYEE_PKG.", () => {
    const catalog = createMockCatalog();
    const sql = "BEGIN EMPLOYEE_PKG./*|*/ END;";
    const items = complete(sql, catalog);
    expect(labels(items)).not.toContain("DEPT_ID");
    expect(labels(items)).not.toContain("DEPT_NAME");
  });
});

// ─── 6. Object names appear (packages, sequences, functions) ─────────────────

describe("Object names appear in top-level completions", () => {
  it("EMPLOYEE_PKG (package) appears when typing EMP", () => {
    const catalog = createMockCatalog();
    const sql = "BEGIN EMP/*|*/ END;";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("EMPLOYEE_PKG");
  });

  it("EMP_SEQ (sequence) appears when typing EMP", () => {
    const catalog = createMockCatalog();
    const sql = "BEGIN EMP/*|*/ END;";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("EMP_SEQ");
  });

  it("CALC_SALARY (function) appears with no prefix", () => {
    const catalog = createMockCatalog();
    const sql = "BEGIN /*|*/ END;";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("CALC_SALARY");
  });

  it("EMPLOYEE_PKG has kind Module", () => {
    const catalog = createMockCatalog();
    const sql = "BEGIN /*|*/ END;";
    const items = complete(sql, catalog);
    expect(findItem(items, "EMPLOYEE_PKG")?.kind).toBe(
      CompletionItemKind.Module,
    );
  });

  it("EMP_SEQ has kind Constant", () => {
    const catalog = createMockCatalog();
    const sql = "BEGIN /*|*/ END;";
    const items = complete(sql, catalog);
    expect(findItem(items, "EMP_SEQ")?.kind).toBe(CompletionItemKind.Constant);
  });

  it("CALC_SALARY has kind Function", () => {
    const catalog = createMockCatalog();
    const sql = "BEGIN /*|*/ END;";
    const items = complete(sql, catalog);
    expect(findItem(items, "CALC_SALARY")?.kind).toBe(
      CompletionItemKind.Function,
    );
  });

  it("object detail shows lowercased object type", () => {
    const catalog = createMockCatalog();
    const sql = "BEGIN /*|*/ END;";
    const items = complete(sql, catalog);
    expect(findItem(items, "EMPLOYEE_PKG")?.detail).toBe("package");
    expect(findItem(items, "EMP_SEQ")?.detail).toBe("sequence");
    expect(findItem(items, "CALC_SALARY")?.detail).toBe("function");
  });
});

// ─── 7. Catalog items appear alongside local symbols ─────────────────────────

describe("Catalog items appear alongside local symbols", () => {
  it("local variable v_emp_id and catalog table EMPLOYEES both appear", () => {
    const catalog = createMockCatalog();
    const sql =
      "CREATE PROCEDURE p AS v_emp_id NUMBER; BEGIN /*|*/ END;";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("v_emp_id");
    expect(labels(items)).toContain("EMPLOYEES");
  });

  it("local parameter p_dept and catalog package EMPLOYEE_PKG both appear", () => {
    const catalog = createMockCatalog();
    const sql =
      "CREATE PROCEDURE p (p_dept IN NUMBER) AS BEGIN /*|*/ END;";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("p_dept");
    expect(labels(items)).toContain("EMPLOYEE_PKG");
  });

  it("local variable v_emp_id has kind Variable", () => {
    const catalog = createMockCatalog();
    const sql =
      "CREATE PROCEDURE p AS v_emp_id NUMBER; BEGIN /*|*/ END;";
    const items = complete(sql, catalog);
    expect(findItem(items, "v_emp_id")?.kind).toBe(CompletionItemKind.Variable);
  });

  it("catalog table EMPLOYEES has kind Struct even when local symbols present", () => {
    const catalog = createMockCatalog();
    const sql =
      "CREATE PROCEDURE p AS v_emp_id NUMBER; BEGIN /*|*/ END;";
    const items = complete(sql, catalog);
    expect(findItem(items, "EMPLOYEES")?.kind).toBe(CompletionItemKind.Struct);
  });
});

// ─── 8. No catalog completions when not connected ────────────────────────────

describe("No catalog completions when not connected", () => {
  it("passing no catalog yields no table items", () => {
    const sql = "SELECT * FROM /*|*/";
    const items = complete(sql, undefined);
    const tableItems = items.filter((i) => i.kind === CompletionItemKind.Struct);
    // Struct kind is only used for tables in this code
    expect(tableItems).toHaveLength(0);
  });

  it("passing no catalog yields no Field items for column completion", () => {
    const sql = "SELECT employees./*|*/ FROM employees";
    const items = complete(sql, undefined);
    const fieldItems = items.filter((i) => i.kind === CompletionItemKind.Field);
    expect(fieldItems).toHaveLength(0);
  });

  it("passing no catalog still yields keyword completions", () => {
    const sql = "SELECT * FROM /*|*/";
    const items = complete(sql, undefined);
    expect(labels(items)).toContain("SELECT");
    expect(labels(items)).toContain("FROM");
  });

  it("disconnected catalog (isConnected false) yields no table items", () => {
    const catalog = new CatalogProvider("nonexistent");
    // _connected is false by default, cache is null
    const sql = "SELECT * FROM /*|*/";
    const items = complete(sql, catalog);
    const tableItems = items.filter((i) => i.kind === CompletionItemKind.Struct);
    expect(tableItems).toHaveLength(0);
  });

  it("EMPLOYEES does not appear when catalog is undefined", () => {
    const sql = "SELECT * FROM EMP/*|*/";
    const items = complete(sql, undefined);
    expect(labels(items)).not.toContain("EMPLOYEES");
  });
});

// ─── 9. Column completion detail shows formatted type ────────────────────────

describe("Column completion detail shows formatted type", () => {
  it("EMPLOYEE_ID detail is NUMBER(10)", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT employees./*|*/ FROM employees";
    const items = complete(sql, catalog);
    expect(findItem(items, "EMPLOYEE_ID")?.detail).toBe("NUMBER(10)");
  });

  it("FIRST_NAME detail is VARCHAR2(50)", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT employees./*|*/ FROM employees";
    const items = complete(sql, catalog);
    expect(findItem(items, "FIRST_NAME")?.detail).toBe("VARCHAR2(50)");
  });

  it("LAST_NAME detail is VARCHAR2(50)", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT employees./*|*/ FROM employees";
    const items = complete(sql, catalog);
    expect(findItem(items, "LAST_NAME")?.detail).toBe("VARCHAR2(50)");
  });

  it("SALARY detail is NUMBER(10,2) reflecting precision and scale", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT employees./*|*/ FROM employees";
    const items = complete(sql, catalog);
    expect(findItem(items, "SALARY")?.detail).toBe("NUMBER(10,2)");
  });

  it("DEPT_ID detail is NUMBER (no precision specified)", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT departments./*|*/ FROM departments";
    const items = complete(sql, catalog);
    expect(findItem(items, "DEPT_ID")?.detail).toBe("NUMBER");
  });

  it("DEPT_NAME detail is VARCHAR2(100)", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT departments./*|*/ FROM departments";
    const items = complete(sql, catalog);
    expect(findItem(items, "DEPT_NAME")?.detail).toBe("VARCHAR2(100)");
  });
});

// ─── 10. Schema-qualified two-dot chain completion ────────────────────────────

describe("Schema-qualified two-dot chain completion", () => {
  it("HR.EMPLOYEES. shows column completions (schema ignored, table resolved)", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT HR.EMPLOYEES./*|*/ FROM HR.EMPLOYEES";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("EMPLOYEE_ID");
    expect(labels(items)).toContain("FIRST_NAME");
    expect(labels(items)).toContain("SALARY");
  });

  it("hr.employees. shows columns (case-insensitive schema prefix)", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT hr.employees./*|*/ FROM hr.employees";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("EMPLOYEE_ID");
    expect(labels(items)).toContain("LAST_NAME");
  });

  it("HR.EMPLOYEE_PKG. shows package members (schema ignored, package resolved)", () => {
    const catalog = createMockCatalog();
    const sql = "BEGIN HR.EMPLOYEE_PKG./*|*/ END;";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("ADD_EMPLOYEE");
    expect(labels(items)).toContain("GET_NAME");
  });

  it("prefix filtering works after schema.table.", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT HR.EMPLOYEES.EMP/*|*/ FROM HR.EMPLOYEES";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("EMPLOYEE_ID");
    expect(labels(items)).not.toContain("FIRST_NAME");
    expect(labels(items)).not.toContain("SALARY");
  });

  it("schema.departments. shows DEPT columns", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT MYSCHEMA.departments./*|*/ FROM departments";
    const items = complete(sql, catalog);
    expect(labels(items)).toContain("DEPT_ID");
    expect(labels(items)).toContain("DEPT_NAME");
  });
});

// ─── 11. Catalog items sort after local symbols ───────────────────────────────

describe("Catalog items sort after local symbols", () => {
  it("table items have sortText starting with '3'", () => {
    const catalog = createMockCatalog();
    const sql = "SELECT * FROM /*|*/";
    const items = complete(sql, catalog);
    const empItem = findItem(items, "EMPLOYEES");
    expect(empItem).toBeDefined();
    expect(empItem!.sortText).toBeDefined();
    expect(empItem!.sortText!.startsWith("3")).toBe(true);
  });

  it("object items have sortText starting with '3'", () => {
    const catalog = createMockCatalog();
    const sql = "BEGIN /*|*/ END;";
    const items = complete(sql, catalog);
    const pkgItem = findItem(items, "EMPLOYEE_PKG");
    expect(pkgItem).toBeDefined();
    expect(pkgItem!.sortText).toBeDefined();
    expect(pkgItem!.sortText!.startsWith("3")).toBe(true);
  });

  it("local symbol sortText starts with '0', so sorts before catalog tables ('3')", () => {
    const catalog = createMockCatalog();
    const sql =
      "CREATE PROCEDURE p AS v_emp_id NUMBER; BEGIN /*|*/ END;";
    const items = complete(sql, catalog);
    const localItem = findItem(items, "v_emp_id");
    const tableItem = findItem(items, "EMPLOYEES");
    expect(localItem!.sortText!.startsWith("0")).toBe(true);
    expect(tableItem!.sortText!.startsWith("3")).toBe(true);
  });
});
