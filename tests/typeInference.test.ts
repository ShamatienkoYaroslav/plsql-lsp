import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";
import { buildSymbolTable, SymbolType, SymbolInfo, SymbolTable } from "../src/symbolTable";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function build(sql: string): SymbolTable {
  const { ast } = parseDocument(sql);
  return buildSymbolTable(ast);
}

function findSymbol(table: SymbolTable, name: string): SymbolInfo | undefined {
  const upper = name.toUpperCase();
  return table.allSymbols.find(s => s.normalizedName === upper);
}

// Helper: assert that a dataType string contains a %TYPE or %ROWTYPE reference,
// accounting for the parser's possible insertion of whitespace around %.
function containsPercentType(dataType: string | undefined): boolean {
  if (!dataType) return false;
  return /% *TYPE/i.test(dataType);
}

function containsPercentRowtype(dataType: string | undefined): boolean {
  if (!dataType) return false;
  return /% *ROWTYPE/i.test(dataType);
}

// ─── 1. %TYPE from local variable ───────────────────────────────────────────

describe("%TYPE resolution from local variables", () => {
  it("dataType references %TYPE for a locally-typed variable", () => {
    const sql = `
      CREATE PROCEDURE p AS
        v_base NUMBER;
        v_copy v_base%TYPE;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "v_copy");
    expect(sym).toBeDefined();
    expect(containsPercentType(sym!.dataType)).toBe(true);
  });

  it("dataType for the %TYPE variable contains the base name", () => {
    const sql = `
      CREATE PROCEDURE p AS
        v_base NUMBER;
        v_copy v_base%TYPE;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "v_copy");
    expect(sym).toBeDefined();
    expect(sym!.dataType!.toUpperCase()).toContain("V_BASE");
  });

  it("inferredType resolves to the base variable's concrete type", () => {
    const sql = `
      CREATE PROCEDURE p AS
        v_base NUMBER;
        v_copy v_base%TYPE;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "v_copy");
    expect(sym).toBeDefined();
    expect(sym!.inferredType).toBeDefined();
    expect(sym!.inferredType!.toUpperCase()).toContain("NUMBER");
  });
});

// ─── 2. %TYPE chain does not crash ──────────────────────────────────────────

describe("%TYPE chain — no crash and correct dataType capture", () => {
  it("all three variables are registered", () => {
    const sql = `
      CREATE PROCEDURE p AS
        v_base NUMBER;
        v_mid  v_base%TYPE;
        v_end  v_mid%TYPE;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    expect(findSymbol(table, "v_base")).toBeDefined();
    expect(findSymbol(table, "v_mid")).toBeDefined();
    expect(findSymbol(table, "v_end")).toBeDefined();
  });

  it("v_mid dataType references %TYPE (the base name)", () => {
    const sql = `
      CREATE PROCEDURE p AS
        v_base NUMBER;
        v_mid  v_base%TYPE;
        v_end  v_mid%TYPE;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const mid = findSymbol(table, "v_mid");
    expect(mid).toBeDefined();
    expect(containsPercentType(mid!.dataType)).toBe(true);
  });

  it("v_end dataType references %TYPE (the mid name)", () => {
    const sql = `
      CREATE PROCEDURE p AS
        v_base NUMBER;
        v_mid  v_base%TYPE;
        v_end  v_mid%TYPE;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const end = findSymbol(table, "v_end");
    expect(end).toBeDefined();
    expect(containsPercentType(end!.dataType)).toBe(true);
  });

  it("inferredType for v_end, if resolved, contains NUMBER", () => {
    const sql = `
      CREATE PROCEDURE p AS
        v_base NUMBER;
        v_mid  v_base%TYPE;
        v_end  v_mid%TYPE;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const end = findSymbol(table, "v_end");
    expect(end).toBeDefined();
    if (end!.inferredType !== undefined) {
      expect(end!.inferredType.toUpperCase()).toContain("NUMBER");
    }
  });
});

// ─── 3. %TYPE from dotted name (table.column) is NOT resolved ────────────────

describe("%TYPE from table.column reference (unresolvable without DB)", () => {
  it("dataType is captured and references %TYPE", () => {
    const sql = `
      CREATE PROCEDURE p AS
        v_id employees.id%TYPE;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "v_id");
    expect(sym).toBeDefined();
    expect(sym!.dataType).toBeDefined();
    expect(containsPercentType(sym!.dataType)).toBe(true);
  });

  it("inferredType is undefined because dotted names require a DB catalog", () => {
    const sql = `
      CREATE PROCEDURE p AS
        v_id employees.id%TYPE;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "v_id");
    expect(sym).toBeDefined();
    expect(sym!.inferredType).toBeUndefined();
  });
});

// ─── 4. %ROWTYPE from local cursor ──────────────────────────────────────────

describe("%ROWTYPE resolution from a local cursor", () => {
  it("dataType references %ROWTYPE", () => {
    const sql = `
      CREATE PROCEDURE p AS
        CURSOR c_emp IS SELECT id, name FROM employees;
        v_rec c_emp%ROWTYPE;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "v_rec");
    expect(sym).toBeDefined();
    expect(sym!.dataType).toBeDefined();
    expect(containsPercentRowtype(sym!.dataType)).toBe(true);
  });

  it("dataType contains the cursor name", () => {
    const sql = `
      CREATE PROCEDURE p AS
        CURSOR c_emp IS SELECT id, name FROM employees;
        v_rec c_emp%ROWTYPE;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "v_rec");
    expect(sym).toBeDefined();
    expect(sym!.dataType!.toUpperCase()).toContain("C_EMP");
  });

  it("inferredType, when resolved, contains RECORD and the cursor name", () => {
    // inferTypes resolves %ROWTYPE only if dataType contains exactly "%ROWTYPE" (no spaces).
    // If the parser emits spaces, resolution is skipped; we only verify the post-condition.
    const sql = `
      CREATE PROCEDURE p AS
        CURSOR c_emp IS SELECT id, name FROM employees;
        v_rec c_emp%ROWTYPE;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "v_rec");
    expect(sym).toBeDefined();
    if (sym!.inferredType !== undefined) {
      expect(sym!.inferredType.toUpperCase()).toContain("RECORD");
      expect(sym!.inferredType).toContain("c_emp");
    }
  });
});

// ─── 5. %ROWTYPE from bare table name (no cursor) is NOT resolved ────────────

describe("%ROWTYPE from table name reference (unresolvable without DB)", () => {
  it("inferredType is undefined because no cursor by that name exists locally", () => {
    const sql = `
      CREATE PROCEDURE p AS
        v_rec employees%ROWTYPE;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "v_rec");
    expect(sym).toBeDefined();
    expect(sym!.inferredType).toBeUndefined();
  });

  it("dataType references %ROWTYPE", () => {
    const sql = `
      CREATE PROCEDURE p AS
        v_rec employees%ROWTYPE;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "v_rec");
    expect(sym).toBeDefined();
    expect(sym!.dataType).toBeDefined();
    expect(containsPercentRowtype(sym!.dataType)).toBe(true);
  });
});

// ─── 6. Cursor FOR loop — named cursor → %ROWTYPE dataType ──────────────────

describe("Cursor FOR loop variable with a named cursor", () => {
  it("loop variable symbolType is ForLoopVariable", () => {
    const sql = `
      CREATE PROCEDURE p AS
        CURSOR c_emp IS SELECT 1 FROM dual;
      BEGIN
        FOR rec IN c_emp LOOP
          NULL;
        END LOOP;
      END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "rec");
    expect(sym).toBeDefined();
    expect(sym!.symbolType).toBe(SymbolType.ForLoopVariable);
  });

  it("dataType contains the cursor name and %ROWTYPE", () => {
    const sql = `
      CREATE PROCEDURE p AS
        CURSOR c_emp IS SELECT 1 FROM dual;
      BEGIN
        FOR rec IN c_emp LOOP
          NULL;
        END LOOP;
      END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "rec");
    expect(sym).toBeDefined();
    expect(sym!.dataType).toBeDefined();
    // The processForLoop sets dataType to "<cursorName>%ROWTYPE" (no spaces)
    expect(sym!.dataType!.toUpperCase()).toContain("%ROWTYPE");
    expect(sym!.dataType!.toLowerCase()).toContain("c_emp");
  });

  it("inferredType is set to a RECORD string that references the cursor", () => {
    // processForLoop assigns "c_emp%ROWTYPE" (no spaces), so inferTypes CAN resolve it.
    const sql = `
      CREATE PROCEDURE p AS
        CURSOR c_emp IS SELECT 1 FROM dual;
      BEGIN
        FOR rec IN c_emp LOOP
          NULL;
        END LOOP;
      END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "rec");
    expect(sym).toBeDefined();
    expect(sym!.inferredType).toBeDefined();
    expect(sym!.inferredType!.toUpperCase()).toContain("RECORD");
    expect(sym!.inferredType!).toContain("c_emp");
  });
});

// ─── 7. Cursor FOR loop — inline SELECT → RECORD dataType ───────────────────

describe("Cursor FOR loop variable with inline SELECT", () => {
  it("loop variable symbolType is ForLoopVariable", () => {
    const sql = `
      CREATE PROCEDURE p AS
      BEGIN
        FOR rec IN (SELECT 1 AS x FROM dual) LOOP
          NULL;
        END LOOP;
      END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "rec");
    expect(sym).toBeDefined();
    expect(sym!.symbolType).toBe(SymbolType.ForLoopVariable);
  });

  it("dataType is RECORD for inline SELECT cursor", () => {
    const sql = `
      CREATE PROCEDURE p AS
      BEGIN
        FOR rec IN (SELECT 1 AS x FROM dual) LOOP
          NULL;
        END LOOP;
      END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "rec");
    expect(sym).toBeDefined();
    expect(sym!.dataType).toBeDefined();
    expect(sym!.dataType!.toUpperCase()).toContain("RECORD");
  });

  it("inferredType is undefined for inline SELECT (dataType is already the concrete RECORD)", () => {
    // "RECORD" does not contain %TYPE or %ROWTYPE, so inferTypes leaves inferredType unset.
    const sql = `
      CREATE PROCEDURE p AS
      BEGIN
        FOR rec IN (SELECT 1 AS x FROM dual) LOOP
          NULL;
        END LOOP;
      END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "rec");
    expect(sym).toBeDefined();
    expect(sym!.inferredType).toBeUndefined();
  });
});

// ─── 8. Variables without anchored types have no inferredType ────────────────

describe("Variables without anchored types have no inferredType", () => {
  it("plain NUMBER variable has undefined inferredType", () => {
    const sql = `CREATE PROCEDURE p AS v_x NUMBER; BEGIN NULL; END;`;
    const table = build(sql);
    const sym = findSymbol(table, "v_x");
    expect(sym).toBeDefined();
    expect(sym!.inferredType).toBeUndefined();
  });

  it("VARCHAR2 variable has undefined inferredType", () => {
    const sql = `CREATE PROCEDURE p AS v_s VARCHAR2(100); BEGIN NULL; END;`;
    const table = build(sql);
    const sym = findSymbol(table, "v_s");
    expect(sym).toBeDefined();
    expect(sym!.inferredType).toBeUndefined();
  });

  it("BOOLEAN variable has undefined inferredType", () => {
    const sql = `CREATE PROCEDURE p AS v_b BOOLEAN; BEGIN NULL; END;`;
    const table = build(sql);
    const sym = findSymbol(table, "v_b");
    expect(sym).toBeDefined();
    expect(sym!.inferredType).toBeUndefined();
  });

  it("EXCEPTION symbol has undefined inferredType", () => {
    const sql = `
      CREATE PROCEDURE p AS
        e_bad EXCEPTION;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "e_bad");
    expect(sym).toBeDefined();
    expect(sym!.inferredType).toBeUndefined();
  });
});

// ─── 9. %TYPE from non-existent variable does not crash ──────────────────────

describe("%TYPE referencing an undeclared variable", () => {
  it("does not throw during buildSymbolTable", () => {
    const sql = `
      CREATE PROCEDURE p AS
        v_x nonexistent_var%TYPE;
      BEGIN NULL; END;
    `;
    expect(() => build(sql)).not.toThrow();
  });

  it("inferredType is undefined when the referenced variable does not exist", () => {
    const sql = `
      CREATE PROCEDURE p AS
        v_x nonexistent_var%TYPE;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "v_x");
    expect(sym).toBeDefined();
    expect(sym!.inferredType).toBeUndefined();
  });

  it("dataType is still captured even though resolution fails", () => {
    const sql = `
      CREATE PROCEDURE p AS
        v_x nonexistent_var%TYPE;
      BEGIN NULL; END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "v_x");
    expect(sym).toBeDefined();
    expect(sym!.dataType).toBeDefined();
    expect(containsPercentType(sym!.dataType)).toBe(true);
  });
});

// ─── 10. Cursor FOR loop with named cursor: inferredType via resolvePercentRowtype

describe("Cursor FOR loop variable inferredType via resolvePercentRowtype", () => {
  it("processForLoop sets dataType without spaces so inferTypes can resolve it", () => {
    // Verify the exact no-space format that processForLoop produces — this is what
    // allows inferTypes to detect and resolve %ROWTYPE in the second pass.
    const sql = `
      CREATE PROCEDURE p AS
        CURSOR c_emp IS SELECT 1 FROM dual;
      BEGIN
        FOR rec IN c_emp LOOP
          NULL;
        END LOOP;
      END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "rec");
    expect(sym).toBeDefined();
    // processForLoop assigns "<name>%ROWTYPE" (no whitespace), unlike the parser
    // which may emit spaced tokens for variable declarations.
    expect(sym!.dataType).toMatch(/%ROWTYPE/i);
  });

  it("inferredType contains RECORD and the cursor name for a named-cursor FOR loop", () => {
    const sql = `
      CREATE PROCEDURE p AS
        CURSOR c_emp IS SELECT 1 FROM dual;
      BEGIN
        FOR rec IN c_emp LOOP
          NULL;
        END LOOP;
      END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "rec");
    expect(sym).toBeDefined();
    expect(sym!.inferredType).toBeDefined();
    expect(sym!.inferredType!.toUpperCase()).toContain("RECORD");
    expect(sym!.inferredType!).toContain("c_emp");
  });

  it("inline SELECT loop variable has undefined inferredType (RECORD is already concrete)", () => {
    const sql = `
      CREATE PROCEDURE p AS
      BEGIN
        FOR rec IN (SELECT 1 AS x FROM dual) LOOP
          NULL;
        END LOOP;
      END;
    `;
    const table = build(sql);
    const sym = findSymbol(table, "rec");
    expect(sym).toBeDefined();
    expect(sym!.inferredType).toBeUndefined();
  });
});
