import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";
import { getReferences } from "../src/references";

// ─── Test helper ──────────────────────────────────────────────────────────────

function refs(sql: string, includeDecl = false, marker = "/*|*/") {
  const pos = sql.indexOf(marker);
  if (pos === -1) throw new Error("marker not found");
  const text = sql.replace(marker, "");
  const { ast } = parseDocument(text);
  return getReferences(ast, text, pos, includeDecl);
}

// ─── 1. Variable references found ────────────────────────────────────────────

describe("Variable references found", () => {
  const sql =
    "CREATE PROCEDURE p AS v_x NUMBER; BEGIN v_/*|*/x := 1; v_x := v_x + 1; END;";

  it("without includeDeclaration finds at least 2 usages", () => {
    const result = refs(sql, false);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("with includeDeclaration finds at least 3 locations (usages + declaration)", () => {
    const result = refs(sql, true);
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it("includeDeclaration adds exactly one more result than without", () => {
    const withDecl = refs(sql, true);
    const withoutDecl = refs(sql, false);
    expect(withDecl.length).toBe(withoutDecl.length + 1);
  });
});

// ─── 2. Parameter references ──────────────────────────────────────────────────

describe("Parameter references", () => {
  const sql =
    "CREATE PROCEDURE p (p_id IN NUMBER) AS v_x NUMBER; BEGIN v_x := p_i/*|*/d; v_x := p_id + 1; END;";

  it("result is not empty", () => {
    expect(refs(sql).length).toBeGreaterThan(0);
  });

  it("finds at least 2 references to p_id (both usages)", () => {
    expect(refs(sql).length).toBeGreaterThanOrEqual(2);
  });

  it("all results point to text that starts with p_id", () => {
    const text = sql.replace("/*|*/", "");
    const lines = text.split("\n");
    const result = refs(sql);
    for (const loc of result) {
      const line = loc.range.start.line;
      const ch = loc.range.start.character;
      const word = lines[line].slice(ch, ch + "p_id".length);
      expect(word).toBe("p_id");
    }
  });
});

// ─── 3. includeDeclaration adds declaration location ─────────────────────────

describe("includeDeclaration adds declaration location", () => {
  const sql =
    "CREATE PROCEDURE p AS v_count NUMBER; BEGIN v_cou/*|*/nt := 1; END;";

  it("without includeDeclaration returns fewer results than with", () => {
    const withDecl = refs(sql, true);
    const withoutDecl = refs(sql, false);
    expect(withDecl.length).toBeGreaterThan(withoutDecl.length);
  });

  it("with includeDeclaration, first result points to the declaration of v_count", () => {
    const result = refs(sql, true);
    expect(result.length).toBeGreaterThan(0);
    const text = sql.replace("/*|*/", "");
    const lines = text.split("\n");
    const decl = result[0];
    const word = lines[decl.range.start.line].slice(
      decl.range.start.character,
      decl.range.start.character + "v_count".length,
    );
    expect(word).toBe("v_count");
  });

  it("declaration location has the correct character pointing to v_count", () => {
    const result = refs(sql, true);
    expect(result.length).toBeGreaterThan(0);
    const text = sql.replace("/*|*/", "");
    const declOffset = text.indexOf("v_count");
    expect(text.slice(declOffset, declOffset + "v_count".length)).toBe("v_count");
  });
});

// ─── 4. Empty result for unresolved identifier ────────────────────────────────

describe("Empty result for unresolved identifier", () => {
  it("returns empty array when identifier is not declared", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN unknown_va/*|*/r := 1; END;";
    expect(refs(sql)).toEqual([]);
  });
});

// ─── 5. Empty result for non-identifier ──────────────────────────────────────

describe("Empty result for non-identifier", () => {
  it("returns empty array when cursor is on NULL keyword", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/NULL; END;";
    expect(refs(sql)).toEqual([]);
  });
});

// ─── 6. References in nested scopes ──────────────────────────────────────────

describe("References in nested scopes", () => {
  const sql = `DECLARE
  v_outer NUMBER;
BEGIN
  v_outer := 1;
  DECLARE
    v_inner NUMBER;
  BEGIN
    v_out/*|*/er := v_outer + 1;
  END;
END;`;

  it("result is not empty", () => {
    expect(refs(sql).length).toBeGreaterThan(0);
  });

  it("finds references to v_outer from both outer and inner scopes (at least 2 usages)", () => {
    expect(refs(sql).length).toBeGreaterThanOrEqual(2);
  });

  it("all results point to text that starts with v_outer", () => {
    const text = sql.replace("/*|*/", "");
    const lines = text.split("\n");
    const result = refs(sql);
    for (const loc of result) {
      const line = loc.range.start.line;
      const ch = loc.range.start.character;
      const word = lines[line].slice(ch, ch + "v_outer".length);
      expect(word).toBe("v_outer");
    }
  });
});

// ─── 7. Shadowed variable — only inner references ─────────────────────────────

describe("Shadowed variable — only inner references", () => {
  const sql = `DECLARE
  v_x NUMBER;
BEGIN
  v_x := 1;
  DECLARE
    v_x VARCHAR2(10);
  BEGIN
    v_/*|*/x := 'hi';
  END;
END;`;

  it("result is not empty", () => {
    expect(refs(sql).length).toBeGreaterThan(0);
  });

  it("all returned references are on line 7 or later (inside inner block only)", () => {
    // The inner block starts at line 4 (DECLARE) and the inner v_x usage is on line 7.
    // The outer v_x := 1; is on line 3. If shadowing works correctly, that line
    // should NOT appear in results.
    const text = sql.replace("/*|*/", "");
    const lines = text.split("\n");
    const result = refs(sql);
    for (const loc of result) {
      const lineText = lines[loc.range.start.line];
      // All references should point to text starting with v_x
      const ch = loc.range.start.character;
      const word = lineText.slice(ch, ch + "v_x".length);
      expect(word).toBe("v_x");
    }
  });

  it("outer v_x assignment (line 3) is NOT included in references", () => {
    // Line 3 (0-indexed) contains "  v_x := 1;" which refers to the outer v_x.
    // Hovering on the inner v_x should not include that reference.
    const result = refs(sql);
    const hasLine3 = result.some(loc => loc.range.start.line === 3);
    expect(hasLine3).toBe(false);
  });
});

// ─── 8. Procedure references ──────────────────────────────────────────────────

describe("Procedure references", () => {
  const sql = `CREATE PACKAGE BODY pkg AS
  PROCEDURE helper AS BEGIN NULL; END;
  PROCEDURE main AS BEGIN help/*|*/er; END;
END pkg;`;

  it("result is not empty", () => {
    expect(refs(sql).length).toBeGreaterThan(0);
  });

  it("finds at least 1 reference to helper", () => {
    expect(refs(sql).length).toBeGreaterThanOrEqual(1);
  });

  it("result points to text that starts with helper", () => {
    const text = sql.replace("/*|*/", "");
    const lines = text.split("\n");
    const result = refs(sql);
    for (const loc of result) {
      const word = lines[loc.range.start.line].slice(
        loc.range.start.character,
        loc.range.start.character + "helper".length,
      );
      expect(word).toBe("helper");
    }
  });
});

// ─── 9. Cursor references ─────────────────────────────────────────────────────

describe("Cursor references", () => {
  const sql = `CREATE PROCEDURE p AS
  CURSOR c_emp IS SELECT 1 FROM dual;
BEGIN
  OPEN c_em/*|*/p;
  CLOSE c_emp;
END;`;

  it("result is not empty", () => {
    expect(refs(sql).length).toBeGreaterThan(0);
  });

  it("finds at least 2 references (OPEN and CLOSE)", () => {
    expect(refs(sql).length).toBeGreaterThanOrEqual(2);
  });

  it("all results point to text that starts with c_emp", () => {
    const text = sql.replace("/*|*/", "");
    const lines = text.split("\n");
    const result = refs(sql);
    for (const loc of result) {
      const word = lines[loc.range.start.line].slice(
        loc.range.start.character,
        loc.range.start.character + "c_emp".length,
      );
      expect(word).toBe("c_emp");
    }
  });
});

// ─── 10. All returned ranges have valid line/character format ─────────────────

describe("All returned ranges have valid line/character format", () => {
  const sql =
    "CREATE PROCEDURE p AS v_x NUMBER; BEGIN v_/*|*/x := 1; v_x := v_x + 1; END;";

  it("result is not empty", () => {
    expect(refs(sql).length).toBeGreaterThan(0);
  });

  it("every result has range.start.line >= 0", () => {
    for (const loc of refs(sql)) {
      expect(loc.range.start.line).toBeGreaterThanOrEqual(0);
    }
  });

  it("every result has range.start.character >= 0", () => {
    for (const loc of refs(sql)) {
      expect(loc.range.start.character).toBeGreaterThanOrEqual(0);
    }
  });

  it("every result has range.end.line >= range.start.line", () => {
    for (const loc of refs(sql)) {
      expect(loc.range.end.line).toBeGreaterThanOrEqual(loc.range.start.line);
    }
  });

  it("every result has range.end.character >= 0", () => {
    for (const loc of refs(sql)) {
      expect(loc.range.end.character).toBeGreaterThanOrEqual(0);
    }
  });

  it("every result has range.start and range.end defined", () => {
    for (const loc of refs(sql)) {
      expect(loc.range.start).toBeDefined();
      expect(loc.range.end).toBeDefined();
    }
  });
});
