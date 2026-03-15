import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";
import {
  buildSymbolTable,
  resolveSymbol,
  findScopeAtPosition,
  SymbolType,
  SymbolTable,
  Scope,
  SymbolInfo,
} from "../src/symbolTable";

// ─── Test helper ─────────────────────────────────────────────────────────────

function build(sql: string): SymbolTable {
  const { ast } = parseDocument(sql);
  return buildSymbolTable(ast);
}

/** Find a symbol by name (case-insensitive) anywhere in allSymbols. */
function findSymbol(table: SymbolTable, name: string): SymbolInfo | undefined {
  const upper = name.toUpperCase();
  return table.allSymbols.find((s) => s.normalizedName === upper);
}

/** Find a symbol in a specific scope by name (case-insensitive). */
function findInScope(scope: Scope, name: string): SymbolInfo | undefined {
  return scope.symbols.get(name.toUpperCase());
}

/** Find a scope by name. */
function findScope(table: SymbolTable, name: string): Scope | undefined {
  return table.allScopes.find((s) => s.name === name);
}

/** Find a scope by kind. */
function findScopeByKind(table: SymbolTable, kind: string): Scope | undefined {
  return table.allScopes.find((s) => s.kind === kind);
}

/** Get the byte offset of the first occurrence of a substring. */
function offsetOf(sql: string, substr: string, skip = 0): number {
  let pos = -1;
  let found = 0;
  let search = 0;
  while (found <= skip) {
    pos = sql.indexOf(substr, search);
    if (pos === -1) throw new Error(`substring "${substr}" not found in sql`);
    found++;
    search = pos + 1;
  }
  return pos;
}

/** Build a Position using the offset inside sql. */
function posAt(sql: string, substr: string, skip = 0) {
  const offset = offsetOf(sql, substr, skip);
  return { offset, line: 0, col: 0 };
}

// ─── 1. Variable declarations ──────────────────────────────────────────────

describe("Variable declarations", () => {
  it("simple variable has type Variable and correct dataType", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "v_count");
    expect(sym).toBeDefined();
    expect(sym!.symbolType).toBe(SymbolType.Variable);
    expect(sym!.dataType).toContain("NUMBER");
  });

  it("constant has type Constant", () => {
    const sql =
      "CREATE PROCEDURE p AS c_max CONSTANT NUMBER := 100; BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "c_max");
    expect(sym).toBeDefined();
    expect(sym!.symbolType).toBe(SymbolType.Constant);
  });

  it("constant dataType is captured", () => {
    const sql =
      "CREATE PROCEDURE p AS c_max CONSTANT NUMBER := 100; BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "c_max");
    expect(sym!.dataType).toContain("NUMBER");
  });

  it("multiple variables all registered", () => {
    const sql = `
      CREATE PROCEDURE p AS
        v_id   NUMBER;
        v_name VARCHAR2(100);
        v_flag BOOLEAN;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    expect(findSymbol(table, "v_id")).toBeDefined();
    expect(findSymbol(table, "v_name")).toBeDefined();
    expect(findSymbol(table, "v_flag")).toBeDefined();
  });

  it("variable dataType with precision is captured", () => {
    const sql =
      "CREATE PROCEDURE p AS v_name VARCHAR2(100); BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "v_name");
    expect(sym).toBeDefined();
    // Full type text should include VARCHAR2 and precision
    expect(sym!.dataType).toBeDefined();
    expect(sym!.dataType).toContain("VARCHAR2");
  });

  it("variable with %TYPE captures dataType text", () => {
    const sql =
      "CREATE PROCEDURE p AS v_id employees.id%TYPE; BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "v_id");
    expect(sym).toBeDefined();
    expect(sym!.dataType).toBeDefined();
    // Should contain the %TYPE reference text
    expect(sym!.dataType!.toUpperCase()).toContain("TYPE");
  });

  it("normalizedName is uppercased for regular identifiers", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "v_count");
    expect(sym!.normalizedName).toBe("V_COUNT");
  });

  it("name preserves original casing", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "v_count");
    expect(sym!.name).toBe("v_count");
  });
});

// ─── 2. Parameters ────────────────────────────────────────────────────────

describe("Parameters", () => {
  it("IN parameter has mode IN and correct dataType", () => {
    const sql =
      "CREATE PROCEDURE p (p_id IN NUMBER) AS BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "p_id");
    expect(sym).toBeDefined();
    expect(sym!.symbolType).toBe(SymbolType.Parameter);
    expect(sym!.parameterMode).toBe("IN");
    expect(sym!.dataType).toContain("NUMBER");
  });

  it("OUT parameter has mode OUT", () => {
    const sql =
      "CREATE PROCEDURE p (p_result OUT NUMBER) AS BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "p_result");
    expect(sym).toBeDefined();
    expect(sym!.parameterMode).toBe("OUT");
  });

  it("IN OUT parameter has mode IN OUT", () => {
    const sql =
      "CREATE PROCEDURE p (p_val IN OUT NUMBER) AS BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "p_val");
    expect(sym).toBeDefined();
    expect(sym!.parameterMode).toBe("IN OUT");
  });

  it("parameter without mode keyword has undefined parameterMode", () => {
    const sql =
      "CREATE PROCEDURE p (p_val NUMBER) AS BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "p_val");
    expect(sym).toBeDefined();
    expect(sym!.symbolType).toBe(SymbolType.Parameter);
    expect(sym!.parameterMode).toBeUndefined();
  });

  it("multiple parameters all registered", () => {
    const sql = `
      CREATE PROCEDURE p (
        p_id   IN  NUMBER,
        p_name IN  VARCHAR2,
        p_out  OUT NUMBER
      ) AS BEGIN NULL; END;
    `;
    const table = build(sql);
    expect(findSymbol(table, "p_id")).toBeDefined();
    expect(findSymbol(table, "p_name")).toBeDefined();
    expect(findSymbol(table, "p_out")).toBeDefined();
  });

  it("parameters are in the procedure scope, not the parent scope", () => {
    const sql =
      "CREATE PROCEDURE p (p_id IN NUMBER) AS BEGIN NULL; END;";
    const table = build(sql);
    // Should NOT be in global scope
    expect(findInScope(table.globalScope, "p_id")).toBeUndefined();
    // Should be in the procedure's scope
    const procScope = findScope(table, "p");
    expect(procScope).toBeDefined();
    expect(findInScope(procScope!, "p_id")).toBeDefined();
  });
});

// ─── 3. Cursor declarations ──────────────────────────────────────────────

describe("Cursor declarations", () => {
  it("cursor has type Cursor", () => {
    const sql = `
      CREATE PROCEDURE p AS
        CURSOR c_emp IS SELECT id FROM employees;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "c_emp");
    expect(sym).toBeDefined();
    expect(sym!.symbolType).toBe(SymbolType.Cursor);
  });

  it("cursor in package spec has type Cursor", () => {
    const sql = `
      CREATE PACKAGE my_pkg AS
        CURSOR c_emp RETURN employees%ROWTYPE;
      END my_pkg;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "c_emp");
    expect(sym).toBeDefined();
    expect(sym!.symbolType).toBe(SymbolType.Cursor);
  });
});

// ─── 4. Exception declarations ──────────────────────────────────────────

describe("Exception declarations", () => {
  it("exception has type Exception", () => {
    const sql = `
      CREATE PROCEDURE p AS
        e_custom EXCEPTION;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "e_custom");
    expect(sym).toBeDefined();
    expect(sym!.symbolType).toBe(SymbolType.Exception);
  });

  it("multiple exceptions registered", () => {
    const sql = `
      CREATE PROCEDURE p AS
        e_not_found EXCEPTION;
        e_too_many  EXCEPTION;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    expect(findSymbol(table, "e_not_found")).toBeDefined();
    expect(findSymbol(table, "e_too_many")).toBeDefined();
  });
});

// ─── 5. Procedure/Function declarations ──────────────────────────────────

describe("Procedure and Function declarations", () => {
  it("standalone procedure name registered in global scope", () => {
    const sql = "CREATE PROCEDURE my_proc AS BEGIN NULL; END;";
    const table = build(sql);
    const sym = findInScope(table.globalScope, "MY_PROC");
    expect(sym).toBeDefined();
    expect(sym!.symbolType).toBe(SymbolType.Procedure);
  });

  it("standalone function name registered in global scope", () => {
    const sql =
      "CREATE FUNCTION my_func RETURN NUMBER AS BEGIN RETURN 1; END;";
    const table = build(sql);
    const sym = findInScope(table.globalScope, "MY_FUNC");
    expect(sym).toBeDefined();
    expect(sym!.symbolType).toBe(SymbolType.Function);
  });

  it("procedure with body has its own scope", () => {
    const sql =
      "CREATE PROCEDURE my_proc (p_id IN NUMBER) AS v_x NUMBER; BEGIN NULL; END;";
    const table = build(sql);
    const procScope = findScope(table, "my_proc");
    expect(procScope).toBeDefined();
    // Parameter and variable should be in the procedure scope
    expect(findInScope(procScope!, "p_id")).toBeDefined();
    expect(findInScope(procScope!, "v_x")).toBeDefined();
  });

  it("function with body has its own scope containing parameters", () => {
    const sql =
      "CREATE FUNCTION my_func (p_val IN NUMBER) RETURN NUMBER AS BEGIN RETURN p_val; END;";
    const table = build(sql);
    const funcScope = findScope(table, "my_func");
    expect(funcScope).toBeDefined();
    expect(findInScope(funcScope!, "p_val")).toBeDefined();
  });

  it("procedure symbol has correct symbolType", () => {
    const sql = "CREATE PROCEDURE my_proc AS BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "my_proc");
    expect(sym!.symbolType).toBe(SymbolType.Procedure);
  });

  it("function symbol has correct symbolType", () => {
    const sql =
      "CREATE FUNCTION my_func RETURN NUMBER AS BEGIN RETURN 1; END;";
    const table = build(sql);
    const sym = findSymbol(table, "my_func");
    expect(sym!.symbolType).toBe(SymbolType.Function);
  });
});

// ─── 6. Package scope ────────────────────────────────────────────────────

describe("Package scope", () => {
  it("package spec creates its own scope", () => {
    const sql = `
      CREATE PACKAGE my_pkg AS
        PROCEDURE do_something;
        FUNCTION get_value RETURN NUMBER;
      END my_pkg;
    `;
    const table = build(sql);
    const pkgScope = findScope(table, "my_pkg");
    expect(pkgScope).toBeDefined();
    expect(pkgScope!.kind).toBe("PackageSpec");
  });

  it("package spec scope contains declared procedure", () => {
    const sql = `
      CREATE PACKAGE my_pkg AS
        PROCEDURE do_something;
      END my_pkg;
    `;
    const table = build(sql);
    const pkgScope = findScope(table, "my_pkg");
    expect(pkgScope).toBeDefined();
    expect(findInScope(pkgScope!, "do_something")).toBeDefined();
  });

  it("package spec scope contains declared function", () => {
    const sql = `
      CREATE PACKAGE my_pkg AS
        FUNCTION get_value RETURN NUMBER;
      END my_pkg;
    `;
    const table = build(sql);
    const pkgScope = findScope(table, "my_pkg");
    expect(pkgScope).toBeDefined();
    expect(findInScope(pkgScope!, "get_value")).toBeDefined();
  });

  it("package body creates its own scope", () => {
    const sql = `
      CREATE PACKAGE BODY my_pkg AS
        PROCEDURE do_something AS
        BEGIN NULL; END;
      END my_pkg;
    `;
    const table = build(sql);
    const pkgScope = findScope(table, "my_pkg");
    expect(pkgScope).toBeDefined();
    expect(pkgScope!.kind).toBe("PackageBody");
  });

  it("package body scope contains procedure symbol", () => {
    const sql = `
      CREATE PACKAGE BODY my_pkg AS
        PROCEDURE do_something AS
        BEGIN NULL; END;
      END my_pkg;
    `;
    const table = build(sql);
    const pkgScope = findScope(table, "my_pkg");
    expect(pkgScope).toBeDefined();
    expect(findInScope(pkgScope!, "do_something")).toBeDefined();
  });

  it("variable declared in package body is in its scope", () => {
    const sql = `
      CREATE PACKAGE BODY my_pkg AS
        g_counter NUMBER := 0;
        PROCEDURE bump AS BEGIN NULL; END;
      END my_pkg;
    `;
    const table = build(sql);
    const pkgScope = findScope(table, "my_pkg");
    expect(pkgScope).toBeDefined();
    expect(findInScope(pkgScope!, "g_counter")).toBeDefined();
  });
});

// ─── 7. Anonymous blocks ─────────────────────────────────────────────────

describe("Anonymous blocks", () => {
  it("DECLARE block creates a scope with variables", () => {
    const sql = `
      DECLARE
        v_x NUMBER;
        v_y VARCHAR2(50);
      BEGIN
        NULL;
      END;
    `;
    const table = build(sql);
    const anonScope = findScopeByKind(table, "AnonymousBlock");
    expect(anonScope).toBeDefined();
    expect(findInScope(anonScope!, "v_x")).toBeDefined();
    expect(findInScope(anonScope!, "v_y")).toBeDefined();
  });

  it("anonymous block scope is a child of global scope", () => {
    const sql = `
      DECLARE
        v_x NUMBER;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const anonScope = findScopeByKind(table, "AnonymousBlock");
    expect(anonScope).toBeDefined();
    expect(anonScope!.parent).toBe(table.globalScope);
  });

  it("variables in anonymous block are of type Variable", () => {
    const sql = `
      DECLARE
        v_x NUMBER;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "v_x");
    expect(sym).toBeDefined();
    expect(sym!.symbolType).toBe(SymbolType.Variable);
  });
});

// ─── 8. FOR loop scoping ─────────────────────────────────────────────────

describe("FOR loop scoping", () => {
  it("ForRangeLoop creates a scope with ForLoopVariable", () => {
    const sql = `
      CREATE PROCEDURE p AS
      BEGIN
        FOR i IN 1..10 LOOP
          NULL;
        END LOOP;
      END;
    `;
    const table = build(sql);
    const loopScope = findScopeByKind(table, "ForRangeLoop");
    expect(loopScope).toBeDefined();
    const loopVar = findInScope(loopScope!, "i");
    expect(loopVar).toBeDefined();
    expect(loopVar!.symbolType).toBe(SymbolType.ForLoopVariable);
  });

  it("CursorForLoop creates a scope with ForLoopVariable", () => {
    const sql = `
      CREATE PROCEDURE p AS
      BEGIN
        FOR rec IN (SELECT 1 AS x FROM dual) LOOP
          NULL;
        END LOOP;
      END;
    `;
    const table = build(sql);
    const loopScope = findScopeByKind(table, "CursorForLoop");
    expect(loopScope).toBeDefined();
    const loopVar = findInScope(loopScope!, "rec");
    expect(loopVar).toBeDefined();
    expect(loopVar!.symbolType).toBe(SymbolType.ForLoopVariable);
  });

  it("loop variable is NOT visible outside the loop via resolveSymbol", () => {
    const sql = `
      CREATE PROCEDURE p AS
      BEGIN
        FOR i IN 1..10 LOOP
          NULL;
        END LOOP;
        NULL;
      END;
    `;
    // Position after END LOOP — use offset of "END;" near the final end
    const endIdx = sql.lastIndexOf("END;");
    const pos = { offset: endIdx, line: 0, col: 0 };
    const table = build(sql);
    // i should not resolve at a position outside the loop
    const sym = resolveSymbol(table, "i", pos);
    expect(sym).toBeUndefined();
  });
});

// ─── 9. Scope nesting ────────────────────────────────────────────────────

describe("Scope nesting", () => {
  it("inner scope's parent is the outer scope", () => {
    const sql = `
      CREATE PROCEDURE outer_p AS
        PROCEDURE inner_p AS
        BEGIN NULL; END;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const outerScope = findScope(table, "outer_p");
    const innerScope = findScope(table, "inner_p");
    expect(outerScope).toBeDefined();
    expect(innerScope).toBeDefined();
    expect(innerScope!.parent).toBe(outerScope);
  });

  it("outer scope variable visible from inner scope via resolveSymbol", () => {
    const sql =
      "CREATE PROCEDURE p AS v_outer NUMBER; BEGIN NULL; END;";
    const table = build(sql);
    // Position inside BEGIN ... END of the procedure
    const beginIdx = sql.indexOf("BEGIN");
    const pos = { offset: beginIdx + 6, line: 0, col: 0 };
    const sym = resolveSymbol(table, "v_outer", pos);
    expect(sym).toBeDefined();
    expect(sym!.normalizedName).toBe("V_OUTER");
  });

  it("inner scope variable shadows outer scope variable with same name", () => {
    // Nested anonymous blocks with same variable name
    const sql = `
      DECLARE
        v_x NUMBER;
      BEGIN
        DECLARE
          v_x VARCHAR2(10);
        BEGIN
          NULL;
        END;
      END;
    `;
    const table = build(sql);
    // There should be two v_x symbols
    const all = table.allSymbols.filter(
      (s) => s.normalizedName === "V_X",
    );
    expect(all.length).toBe(2);
    // They should be in different scopes
    expect(all[0].scope).not.toBe(all[1].scope);
  });
});

// ─── 10. Symbol resolution (resolveSymbol) ───────────────────────────────

describe("resolveSymbol", () => {
  it("resolves variable at position inside its scope", () => {
    const sql =
      "CREATE PROCEDURE p AS v_count NUMBER; BEGIN NULL; END;";
    const table = build(sql);
    // Position inside BEGIN ... END
    const beginIdx = sql.indexOf("BEGIN");
    const pos = { offset: beginIdx + 6, line: 0, col: 0 };
    const sym = resolveSymbol(table, "v_count", pos);
    expect(sym).toBeDefined();
    expect(sym!.normalizedName).toBe("V_COUNT");
  });

  it("returns undefined when resolving at position outside variable scope", () => {
    const sql =
      "SELECT 1 FROM dual;";
    const table = build(sql);
    const pos = { offset: 0, line: 0, col: 0 };
    const sym = resolveSymbol(table, "v_count", pos);
    expect(sym).toBeUndefined();
  });

  it("resolves outer scope variable from inner scope position", () => {
    const sql = `
      DECLARE
        v_outer NUMBER;
      BEGIN
        DECLARE
          v_inner VARCHAR2(10);
        BEGIN
          NULL;
        END;
      END;
    `;
    const table = build(sql);
    // Position deep inside the inner block — use offset of second NULL
    const innerNullIdx = sql.indexOf("NULL;", sql.indexOf("v_inner"));
    const pos = { offset: innerNullIdx, line: 0, col: 0 };
    const sym = resolveSymbol(table, "v_outer", pos);
    expect(sym).toBeDefined();
    expect(sym!.normalizedName).toBe("V_OUTER");
  });

  it("resolution is case-insensitive — lowercase name finds uppercase symbol", () => {
    const sql =
      "CREATE PROCEDURE p AS V_COUNT NUMBER; BEGIN NULL; END;";
    const table = build(sql);
    const beginIdx = sql.indexOf("BEGIN");
    const pos = { offset: beginIdx + 6, line: 0, col: 0 };
    const sym = resolveSymbol(table, "v_count", pos);
    expect(sym).toBeDefined();
    expect(sym!.normalizedName).toBe("V_COUNT");
  });

  it("resolution is case-insensitive — uppercase name finds lowercase symbol", () => {
    const sql =
      "CREATE PROCEDURE p AS v_count NUMBER; BEGIN NULL; END;";
    const table = build(sql);
    const beginIdx = sql.indexOf("BEGIN");
    const pos = { offset: beginIdx + 6, line: 0, col: 0 };
    const sym = resolveSymbol(table, "V_COUNT", pos);
    expect(sym).toBeDefined();
    expect(sym!.normalizedName).toBe("V_COUNT");
  });

  it("inner shadowing variable is resolved, not outer", () => {
    const sql = `
      DECLARE
        v_x NUMBER;
      BEGIN
        DECLARE
          v_x VARCHAR2(10);
        BEGIN
          NULL;
        END;
      END;
    `;
    const table = build(sql);
    // Position inside inner block
    const innerNullIdx = sql.indexOf("NULL;", sql.indexOf("VARCHAR2"));
    const pos = { offset: innerNullIdx, line: 0, col: 0 };
    const sym = resolveSymbol(table, "v_x", pos);
    expect(sym).toBeDefined();
    // Should resolve to the inner VARCHAR2 declaration
    expect(sym!.dataType).toContain("VARCHAR2");
  });
});

// ─── 11. findScopeAtPosition ─────────────────────────────────────────────

describe("findScopeAtPosition", () => {
  it("position inside procedure returns procedure scope", () => {
    const sql =
      "CREATE PROCEDURE my_proc AS v_x NUMBER; BEGIN NULL; END;";
    const table = build(sql);
    const beginIdx = sql.indexOf("BEGIN");
    const pos = { offset: beginIdx + 6, line: 0, col: 0 };
    const scope = findScopeAtPosition(table, pos);
    expect(scope.name).toBe("my_proc");
  });

  it("position inside FOR loop inside procedure returns loop scope", () => {
    const sql = `
      CREATE PROCEDURE p AS
      BEGIN
        FOR i IN 1..10 LOOP
          NULL;
        END LOOP;
      END;
    `;
    const table = build(sql);
    // Position at NULL inside the loop
    const nullIdx = sql.indexOf("NULL;");
    const pos = { offset: nullIdx, line: 0, col: 0 };
    const scope = findScopeAtPosition(table, pos);
    expect(scope.kind).toBe("ForRangeLoop");
  });

  it("position at very start returns global scope when nothing wraps it", () => {
    const sql = "SELECT 1 FROM dual;";
    const table = build(sql);
    const pos = { offset: 0, line: 0, col: 0 };
    const scope = findScopeAtPosition(table, pos);
    expect(scope).toBe(table.globalScope);
  });

  it("position inside package body returns package scope", () => {
    const sql = `
      CREATE PACKAGE BODY my_pkg AS
        PROCEDURE p AS BEGIN NULL; END;
      END my_pkg;
    `;
    const table = build(sql);
    // Position inside the PROCEDURE body
    const nullIdx = sql.indexOf("NULL;");
    const pos = { offset: nullIdx, line: 0, col: 0 };
    const scope = findScopeAtPosition(table, pos);
    // Should be inside the procedure scope (child of package scope)
    expect(scope.name).toBe("p");
  });
});

// ─── 12. Type declarations ───────────────────────────────────────────────

describe("Type declarations", () => {
  it("TYPE declaration has type Type", () => {
    const sql = `
      CREATE PROCEDURE p AS
        TYPE t_rec IS RECORD (id NUMBER, name VARCHAR2(100));
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "t_rec");
    expect(sym).toBeDefined();
    expect(sym!.symbolType).toBe(SymbolType.Type);
  });

  it("SUBTYPE declaration has type Subtype", () => {
    const sql = `
      CREATE PROCEDURE p AS
        SUBTYPE t_name IS VARCHAR2(100);
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "t_name");
    expect(sym).toBeDefined();
    expect(sym!.symbolType).toBe(SymbolType.Subtype);
  });

  it("SUBTYPE dataType is captured", () => {
    const sql = `
      CREATE PROCEDURE p AS
        SUBTYPE t_name IS VARCHAR2(100);
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "t_name");
    expect(sym).toBeDefined();
    expect(sym!.dataType).toBeDefined();
    expect(sym!.dataType).toContain("VARCHAR2");
  });
});

// ─── 13. Case insensitivity ──────────────────────────────────────────────

describe("Case insensitivity", () => {
  it("upper-case identifier is normalized to uppercase", () => {
    const sql = "CREATE PROCEDURE P AS V_COUNT NUMBER; BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "V_COUNT");
    expect(sym).toBeDefined();
    expect(sym!.normalizedName).toBe("V_COUNT");
  });

  it("mixed-case identifier normalizedName is uppercased", () => {
    const sql = "CREATE PROCEDURE p AS myVariable NUMBER; BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "myVariable");
    expect(sym).toBeDefined();
    expect(sym!.normalizedName).toBe("MYVARIABLE");
  });

  it("symbol lookup in scope map is case-insensitive via normalized key", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; BEGIN NULL; END;";
    const table = build(sql);
    const procScope = findScope(table, "p");
    expect(procScope).toBeDefined();
    // Map key should be uppercase
    expect(procScope!.symbols.has("V_COUNT")).toBe(true);
    expect(procScope!.symbols.has("v_count")).toBe(false);
  });
});

// ─── 14. Global scope ───────────────────────────────────────────────────

describe("Global scope", () => {
  it("DML query produces globalScope with no symbols", () => {
    const table = build("SELECT 1 FROM dual;");
    expect(table.globalScope).toBeDefined();
    expect(table.globalScope.symbols.size).toBe(0);
  });

  it("empty input produces globalScope with no children", () => {
    const table = build("");
    expect(table.globalScope).toBeDefined();
    expect(table.globalScope.children).toHaveLength(0);
  });

  it("globalScope kind is Script", () => {
    const table = build("SELECT 1 FROM dual;");
    expect(table.globalScope.kind).toBe("Script");
  });

  it("allScopes always contains at least the global scope", () => {
    const table = build("SELECT 1 FROM dual;");
    expect(table.allScopes).toContain(table.globalScope);
  });

  it("procedure creates exactly one additional scope", () => {
    const table = build("CREATE PROCEDURE p AS BEGIN NULL; END;");
    // global + procedure scope
    expect(table.allScopes.length).toBeGreaterThanOrEqual(2);
    expect(table.allScopes[0]).toBe(table.globalScope);
  });
});

// ─── 15. Data type extraction ─────────────────────────────────────────────

describe("Data type extraction", () => {
  it("simple NUMBER type is captured as 'NUMBER'", () => {
    const sql = "CREATE PROCEDURE p AS v_n NUMBER; BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "v_n");
    expect(sym!.dataType).toBeDefined();
    expect(sym!.dataType!.toUpperCase()).toContain("NUMBER");
  });

  it("NUMBER with precision is captured and includes NUMBER", () => {
    const sql =
      "CREATE PROCEDURE p AS v_n NUMBER(10,2); BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "v_n");
    expect(sym!.dataType).toBeDefined();
    expect(sym!.dataType!.toUpperCase()).toContain("NUMBER");
  });

  it("VARCHAR2 with length is captured and includes VARCHAR2", () => {
    const sql =
      "CREATE PROCEDURE p AS v_s VARCHAR2(200); BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "v_s");
    expect(sym!.dataType).toBeDefined();
    expect(sym!.dataType!.toUpperCase()).toContain("VARCHAR2");
  });

  it("%TYPE reference is captured and contains TYPE keyword", () => {
    const sql =
      "CREATE PROCEDURE p AS v_id employees.id%TYPE; BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "v_id");
    expect(sym!.dataType).toBeDefined();
    expect(sym!.dataType!.toUpperCase()).toContain("TYPE");
  });

  it("BOOLEAN type is captured", () => {
    const sql =
      "CREATE PROCEDURE p AS v_b BOOLEAN; BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "v_b");
    expect(sym!.dataType).toBeDefined();
    expect(sym!.dataType!.toUpperCase()).toContain("BOOLEAN");
  });
});

// ─── 16. allSymbols and allScopes completeness ──────────────────────────

describe("allSymbols and allScopes", () => {
  it("allSymbols contains every declared symbol", () => {
    const sql = `
      CREATE PROCEDURE p (p_id IN NUMBER) AS
        v_count NUMBER;
        e_err EXCEPTION;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const names = table.allSymbols.map((s) => s.normalizedName);
    expect(names).toContain("P");
    expect(names).toContain("P_ID");
    expect(names).toContain("V_COUNT");
    expect(names).toContain("E_ERR");
  });

  it("allScopes contains global scope and child scopes", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN NULL; END;";
    const table = build(sql);
    expect(table.allScopes).toContain(table.globalScope);
    const procScope = findScope(table, "p");
    expect(table.allScopes).toContain(procScope);
  });

  it("each symbol's scope reference points to the owning scope", () => {
    const sql =
      "CREATE PROCEDURE p AS v_x NUMBER; BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "v_x");
    const procScope = findScope(table, "p");
    expect(sym).toBeDefined();
    expect(sym!.scope).toBe(procScope);
  });
});

// ─── 17. SymbolInfo ranges ──────────────────────────────────────────────

describe("SymbolInfo ranges", () => {
  it("symbol range and nameRange are defined", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "v_count");
    expect(sym!.range).toBeDefined();
    expect(sym!.range.start).toBeDefined();
    expect(sym!.range.end).toBeDefined();
    expect(sym!.nameRange).toBeDefined();
    expect(sym!.nameRange.start).toBeDefined();
    expect(sym!.nameRange.end).toBeDefined();
  });

  it("nameRange is within range", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "v_count");
    expect(sym!.nameRange.start.offset).toBeGreaterThanOrEqual(
      sym!.range.start.offset,
    );
    expect(sym!.nameRange.end.offset).toBeLessThanOrEqual(
      sym!.range.end.offset,
    );
  });

  it("nameRange offset corresponds to identifier position in source", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; BEGIN NULL; END;";
    const table = build(sql);
    const sym = findSymbol(table, "v_count");
    const expectedOffset = sql.indexOf("v_count");
    expect(sym!.nameRange.start.offset).toBe(expectedOffset);
  });
});
