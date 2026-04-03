import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";
import {
  buildSymbolTable,
  resolveReferences,
  SymbolType,
  SymbolTable,
  SymbolInfo,
  Reference,
  ReferenceResult,
} from "../src/symbolTable";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function buildRefs(sql: string): { table: SymbolTable; refs: ReferenceResult } {
  const { ast } = parseDocument(sql);
  const table = buildSymbolTable(ast);
  const refs = resolveReferences(ast, table);
  return { table, refs };
}

/** Find a symbol by name in allSymbols */
function findSymbol(table: SymbolTable, name: string): SymbolInfo | undefined {
  const upper = name.toUpperCase();
  return table.allSymbols.find(s => s.normalizedName === upper);
}

/** Get all references that resolve to a given symbol name */
function refsTo(table: SymbolTable, refs: ReferenceResult, name: string): Reference[] {
  const sym = findSymbol(table, name);
  if (!sym) return [];
  return refs.symbolReferences.get(sym) ?? [];
}

// ─── 1. Basic variable reference ─────────────────────────────────────────────

describe("Basic variable reference", () => {
  it("assignment target is captured as a reference", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; BEGIN v_count := 1; END;";
    const { table, refs } = buildRefs(sql);
    expect(refsTo(table, refs, "v_count").length).toBeGreaterThanOrEqual(1);
  });

  it("reference resolves to the correct symbol normalizedName", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; BEGIN v_count := 1; END;";
    const { table, refs } = buildRefs(sql);
    const varRefs = refsTo(table, refs, "v_count");
    expect(varRefs.length).toBeGreaterThanOrEqual(1);
    expect(varRefs[0].resolvedSymbol.normalizedName).toBe("V_COUNT");
  });

  it("reference resolves to the correct symbolType Variable", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; BEGIN v_count := 1; END;";
    const { table, refs } = buildRefs(sql);
    const varRefs = refsTo(table, refs, "v_count");
    expect(varRefs.length).toBeGreaterThanOrEqual(1);
    expect(varRefs[0].resolvedSymbol.symbolType).toBe(SymbolType.Variable);
  });
});

// ─── 2. Parameter reference ──────────────────────────────────────────────────

describe("Parameter reference", () => {
  it("IN parameter used in body is captured as a reference", () => {
    const sql = "CREATE PROCEDURE p (p_id IN NUMBER) AS v_x NUMBER; BEGIN v_x := p_id; END;";
    const { table, refs } = buildRefs(sql);
    expect(refsTo(table, refs, "p_id").length).toBeGreaterThanOrEqual(1);
  });

  it("local variable assigned from parameter is captured as a reference", () => {
    const sql = "CREATE PROCEDURE p (p_id IN NUMBER) AS v_x NUMBER; BEGIN v_x := p_id; END;";
    const { table, refs } = buildRefs(sql);
    expect(refsTo(table, refs, "v_x").length).toBeGreaterThanOrEqual(1);
  });

  it("parameter reference resolves to symbolType Parameter", () => {
    const sql = "CREATE PROCEDURE p (p_id IN NUMBER) AS v_x NUMBER; BEGIN v_x := p_id; END;";
    const { table, refs } = buildRefs(sql);
    const paramRefs = refsTo(table, refs, "p_id");
    expect(paramRefs.length).toBeGreaterThanOrEqual(1);
    expect(paramRefs[0].resolvedSymbol.symbolType).toBe(SymbolType.Parameter);
  });
});

// ─── 3. Multiple references to same variable ─────────────────────────────────

describe("Multiple references to same variable", () => {
  it("variable assigned multiple times yields multiple references", () => {
    const sql = "CREATE PROCEDURE p AS v_x NUMBER; BEGIN v_x := 1; v_x := v_x + 1; END;";
    const { table, refs } = buildRefs(sql);
    // At minimum: two LHS assignments and one RHS usage = 3; accept >= 2
    expect(refsTo(table, refs, "v_x").length).toBeGreaterThanOrEqual(2);
  });

  it("all references to same variable point to the same SymbolInfo", () => {
    const sql = "CREATE PROCEDURE p AS v_x NUMBER; BEGIN v_x := 1; v_x := v_x + 1; END;";
    const { table, refs } = buildRefs(sql);
    const sym = findSymbol(table, "v_x");
    expect(sym).toBeDefined();
    const varRefs = refsTo(table, refs, "v_x");
    for (const ref of varRefs) {
      expect(ref.resolvedSymbol).toBe(sym);
    }
  });
});

// ─── 4. Declaration identifiers are NOT counted as references ────────────────

describe("Declaration identifiers not in references", () => {
  it("the declaration occurrence of a variable is not in the references list", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; BEGIN v_count := 1; END;";
    const { table, refs } = buildRefs(sql);
    // The first occurrence of "v_count" in the source is the declaration
    const declOffset = sql.indexOf("v_count");
    const refOffsets = refs.references.map(r => r.token.offset);
    expect(refOffsets).not.toContain(declOffset);
  });

  it("symbol nameRange offset does not appear in references", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; BEGIN v_count := 1; END;";
    const { table, refs } = buildRefs(sql);
    const sym = findSymbol(table, "v_count");
    expect(sym).toBeDefined();
    const declOffset = sym!.nameRange.start.offset;
    const refOffsets = refs.references.map(r => r.token.offset);
    expect(refOffsets).not.toContain(declOffset);
  });
});

// ─── 5. Nested scope - inner variable reference ───────────────────────────────

describe("Nested scope references", () => {
  it("inner variable used in inner block is captured as a reference", () => {
    const sql = `DECLARE
  v_outer NUMBER;
BEGIN
  DECLARE
    v_inner NUMBER;
  BEGIN
    v_inner := v_outer;
  END;
END;`;
    const { table, refs } = buildRefs(sql);
    expect(refsTo(table, refs, "v_inner").length).toBeGreaterThanOrEqual(1);
  });

  it("outer variable referenced from inner scope is captured as a reference", () => {
    const sql = `DECLARE
  v_outer NUMBER;
BEGIN
  DECLARE
    v_inner NUMBER;
  BEGIN
    v_inner := v_outer;
  END;
END;`;
    const { table, refs } = buildRefs(sql);
    expect(refsTo(table, refs, "v_outer").length).toBeGreaterThanOrEqual(1);
  });

  it("outer variable reference resolves to the outer declaration", () => {
    const sql = `DECLARE
  v_outer NUMBER;
BEGIN
  DECLARE
    v_inner NUMBER;
  BEGIN
    v_inner := v_outer;
  END;
END;`;
    const { table, refs } = buildRefs(sql);
    const outerSym = findSymbol(table, "v_outer");
    expect(outerSym).toBeDefined();
    const outerRefs = refsTo(table, refs, "v_outer");
    expect(outerRefs.length).toBeGreaterThanOrEqual(1);
    expect(outerRefs[0].resolvedSymbol).toBe(outerSym);
  });
});

// ─── 6. FOR loop variable reference ──────────────────────────────────────────

describe("FOR loop variable reference", () => {
  it("loop counter i used in loop body is captured as a reference", () => {
    const sql = "CREATE PROCEDURE p AS v_sum NUMBER; BEGIN FOR i IN 1..10 LOOP v_sum := v_sum + i; END LOOP; END;";
    const { table, refs } = buildRefs(sql);
    expect(refsTo(table, refs, "i").length).toBeGreaterThanOrEqual(1);
  });

  it("v_sum used inside loop body is captured as a reference", () => {
    const sql = "CREATE PROCEDURE p AS v_sum NUMBER; BEGIN FOR i IN 1..10 LOOP v_sum := v_sum + i; END LOOP; END;";
    const { table, refs } = buildRefs(sql);
    expect(refsTo(table, refs, "v_sum").length).toBeGreaterThanOrEqual(1);
  });

  it("loop counter reference resolves to ForLoopVariable symbolType", () => {
    const sql = "CREATE PROCEDURE p AS v_sum NUMBER; BEGIN FOR i IN 1..10 LOOP v_sum := v_sum + i; END LOOP; END;";
    const { table, refs } = buildRefs(sql);
    const loopRefs = refsTo(table, refs, "i");
    expect(loopRefs.length).toBeGreaterThanOrEqual(1);
    expect(loopRefs[0].resolvedSymbol.symbolType).toBe(SymbolType.ForLoopVariable);
  });
});

// ─── 7. Unresolved identifiers are NOT in references ─────────────────────────

describe("Unresolved identifiers not in references", () => {
  it("identifiers with no matching declaration produce no references", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN some_pkg.do_something; END;";
    const { refs } = buildRefs(sql);
    // some_pkg and do_something are not declared symbols — they should not resolve
    const resolvedNames = refs.references.map(r => r.resolvedSymbol.normalizedName);
    expect(resolvedNames).not.toContain("SOME_PKG");
    expect(resolvedNames).not.toContain("DO_SOMETHING");
  });

  it("references array only contains entries that actually resolved", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN some_pkg.do_something; END;";
    const { refs } = buildRefs(sql);
    // Every reference in the array must have a resolvedSymbol
    for (const ref of refs.references) {
      expect(ref.resolvedSymbol).toBeDefined();
    }
  });
});

// ─── 8. Procedure call reference ─────────────────────────────────────────────

describe("Procedure call reference", () => {
  it("helper procedure called from main is captured as a reference", () => {
    const sql = `CREATE PACKAGE BODY my_pkg AS
  PROCEDURE helper AS BEGIN NULL; END;
  PROCEDURE main AS BEGIN helper; END;
END my_pkg;`;
    const { table, refs } = buildRefs(sql);
    expect(refsTo(table, refs, "helper").length).toBeGreaterThanOrEqual(1);
  });

  it("helper call reference resolves to symbolType Procedure", () => {
    const sql = `CREATE PACKAGE BODY my_pkg AS
  PROCEDURE helper AS BEGIN NULL; END;
  PROCEDURE main AS BEGIN helper; END;
END my_pkg;`;
    const { table, refs } = buildRefs(sql);
    const helperRefs = refsTo(table, refs, "helper");
    expect(helperRefs.length).toBeGreaterThanOrEqual(1);
    expect(helperRefs[0].resolvedSymbol.symbolType).toBe(SymbolType.Procedure);
  });
});

// ─── 9. Reference range is correct ───────────────────────────────────────────

describe("Reference range", () => {
  it("reference range start offset matches the token position in source", () => {
    const sql = "CREATE PROCEDURE p AS v_x NUMBER; BEGIN v_x := 1; END;";
    const { table, refs } = buildRefs(sql);
    const varRefs = refsTo(table, refs, "v_x");
    expect(varRefs.length).toBeGreaterThanOrEqual(1);
    // The reference occurrence is the second "v_x", after BEGIN
    const expectedOffset = sql.indexOf("v_x", sql.indexOf("BEGIN"));
    expect(varRefs[0].range.start.offset).toBe(expectedOffset);
  });

  it("reference range end offset is start plus identifier length", () => {
    const sql = "CREATE PROCEDURE p AS v_x NUMBER; BEGIN v_x := 1; END;";
    const { table, refs } = buildRefs(sql);
    const varRefs = refsTo(table, refs, "v_x");
    expect(varRefs.length).toBeGreaterThanOrEqual(1);
    const ref = varRefs[0];
    expect(ref.range.end.offset).toBe(ref.range.start.offset + "v_x".length);
  });
});

// ─── 10. symbolReferences map is consistent with references array ─────────────

describe("symbolReferences map consistency", () => {
  it("every reference in refs.references appears in symbolReferences under its resolvedSymbol", () => {
    const sql = "CREATE PROCEDURE p AS v_x NUMBER; BEGIN v_x := 1; END;";
    const { refs } = buildRefs(sql);
    for (const ref of refs.references) {
      const mapped = refs.symbolReferences.get(ref.resolvedSymbol) ?? [];
      expect(mapped).toContain(ref);
    }
  });

  it("total count of all symbolReferences map values equals refs.references length", () => {
    const sql = "CREATE PROCEDURE p AS v_x NUMBER; BEGIN v_x := 1; END;";
    const { refs } = buildRefs(sql);
    let total = 0;
    for (const refList of refs.symbolReferences.values()) {
      total += refList.length;
    }
    expect(total).toBe(refs.references.length);
  });
});

// ─── 11. Exception reference in RAISE ────────────────────────────────────────

describe("Exception reference in RAISE", () => {
  it("exception identifier in RAISE is captured as a reference", () => {
    const sql = "CREATE PROCEDURE p AS e_custom EXCEPTION; BEGIN RAISE e_custom; END;";
    const { table, refs } = buildRefs(sql);
    expect(refsTo(table, refs, "e_custom").length).toBeGreaterThanOrEqual(1);
  });

  it("exception reference resolves to symbolType Exception", () => {
    const sql = "CREATE PROCEDURE p AS e_custom EXCEPTION; BEGIN RAISE e_custom; END;";
    const { table, refs } = buildRefs(sql);
    const exRefs = refsTo(table, refs, "e_custom");
    expect(exRefs.length).toBeGreaterThanOrEqual(1);
    expect(exRefs[0].resolvedSymbol.symbolType).toBe(SymbolType.Exception);
  });
});

// ─── 12. Cursor reference in OPEN/CLOSE ──────────────────────────────────────

describe("Cursor reference in OPEN/CLOSE", () => {
  it("cursor used in OPEN is captured as a reference", () => {
    const sql = `CREATE PROCEDURE p AS
  CURSOR c_emp IS SELECT 1 FROM dual;
  v_rec NUMBER;
BEGIN
  OPEN c_emp;
  CLOSE c_emp;
END;`;
    const { table, refs } = buildRefs(sql);
    expect(refsTo(table, refs, "c_emp").length).toBeGreaterThanOrEqual(1);
  });

  it("cursor reference resolves to symbolType Cursor", () => {
    const sql = `CREATE PROCEDURE p AS
  CURSOR c_emp IS SELECT 1 FROM dual;
  v_rec NUMBER;
BEGIN
  OPEN c_emp;
  CLOSE c_emp;
END;`;
    const { table, refs } = buildRefs(sql);
    const cursorRefs = refsTo(table, refs, "c_emp");
    expect(cursorRefs.length).toBeGreaterThanOrEqual(1);
    expect(cursorRefs[0].resolvedSymbol.symbolType).toBe(SymbolType.Cursor);
  });
});

// ─── 13. Shadowed variable - inner reference resolves to inner declaration ────

describe("Shadowed variable resolution", () => {
  it("two v_x symbols exist when inner block shadows outer", () => {
    const sql = `DECLARE
  v_x NUMBER;
BEGIN
  DECLARE
    v_x VARCHAR2(10);
  BEGIN
    v_x := 'hello';
  END;
END;`;
    const { table } = buildRefs(sql);
    const all = table.allSymbols.filter(s => s.normalizedName === "V_X");
    expect(all.length).toBe(2);
  });

  it("reference inside inner block resolves to the inner v_x (VARCHAR2)", () => {
    const sql = `DECLARE
  v_x NUMBER;
BEGIN
  DECLARE
    v_x VARCHAR2(10);
  BEGIN
    v_x := 'hello';
  END;
END;`;
    const { table, refs } = buildRefs(sql);
    // The assignment "v_x := 'hello'" is inside the inner block
    const assignOffset = sql.indexOf("v_x", sql.indexOf("VARCHAR2"));
    const matchingRef = refs.references.find(r => r.token.offset === assignOffset);
    expect(matchingRef).toBeDefined();
    // Should resolve to the inner VARCHAR2 v_x
    expect(matchingRef!.resolvedSymbol.dataType).toContain("VARCHAR2");
  });

  it("reference inside inner block does NOT resolve to the outer NUMBER v_x", () => {
    const sql = `DECLARE
  v_x NUMBER;
BEGIN
  DECLARE
    v_x VARCHAR2(10);
  BEGIN
    v_x := 'hello';
  END;
END;`;
    const { table, refs } = buildRefs(sql);
    const assignOffset = sql.indexOf("v_x", sql.indexOf("VARCHAR2"));
    const matchingRef = refs.references.find(r => r.token.offset === assignOffset);
    expect(matchingRef).toBeDefined();
    expect(matchingRef!.resolvedSymbol.dataType).not.toContain("NUMBER");
  });
});
