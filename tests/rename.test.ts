import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";
import { getRenameEdits, prepareRename } from "../src/rename";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function rename(sql: string, newName: string, marker = "/*|*/") {
  const pos = sql.indexOf(marker);
  if (pos === -1) throw new Error("marker not found");
  const text = sql.replace(marker, "");
  const { ast } = parseDocument(text);
  return getRenameEdits(ast, text, pos, newName);
}

function prepare(sql: string, marker = "/*|*/") {
  const pos = sql.indexOf(marker);
  if (pos === -1) throw new Error("marker not found");
  const text = sql.replace(marker, "");
  const { ast } = parseDocument(text);
  return prepareRename(ast, text, pos);
}

// ─── 1. Renames variable at all locations ─────────────────────────────────────

describe("Renames variable at all locations (declaration + references)", () => {
  const sql =
    "CREATE PROCEDURE p AS v_x NUMBER; BEGIN v_/*|*/x := 1; v_x := v_x + 1; END;";

  it("result is not empty", () => {
    const edits = rename(sql, "v_count");
    expect(edits.length).toBeGreaterThan(0);
  });

  it("includes declaration + all usage edits", () => {
    const edits = rename(sql, "v_count");
    // v_x appears: 1 declaration + at least 3 usages (v_x := 1; v_x := v_x + 1)
    expect(edits.length).toBeGreaterThanOrEqual(3);
  });

  it("every edit has newText === 'v_count'", () => {
    const edits = rename(sql, "v_count");
    for (const edit of edits) {
      expect(edit.newText).toBe("v_count");
    }
  });

  it("first edit range covers the declaration of v_x", () => {
    const edits = rename(sql, "v_count");
    expect(edits.length).toBeGreaterThan(0);
    const text = sql.replace("/*|*/", "");
    const lines = text.split("\n");
    const first = edits[0];
    const word = lines[first.range.start.line].slice(
      first.range.start.character,
      first.range.start.character + "v_x".length,
    );
    expect(word).toBe("v_x");
  });
});

// ─── 2. Renames parameter — declaration edit is produced ─────────────────────

describe("Renames parameter — declaration edit is produced", () => {
  const sql =
    "CREATE PROCEDURE p (p_id IN NUMBER) AS v_x NUMBER; BEGIN v_x := p_i/*|*/d; v_x := p_id + 1; END;";

  it("result is not empty", () => {
    const edits = rename(sql, "p_employee_id");
    expect(edits.length).toBeGreaterThan(0);
  });

  it("every edit has newText === 'p_employee_id'", () => {
    const edits = rename(sql, "p_employee_id");
    for (const edit of edits) {
      expect(edit.newText).toBe("p_employee_id");
    }
  });

  it("at least one edit points to text starting with p_id", () => {
    const edits = rename(sql, "p_employee_id");
    const text = sql.replace("/*|*/", "");
    const lines = text.split("\n");
    const hasP_id = edits.some(e => {
      const lineText = lines[e.range.start.line];
      const word = lineText.slice(
        e.range.start.character,
        e.range.start.character + "p_id".length,
      );
      return word === "p_id";
    });
    expect(hasP_id).toBe(true);
  });
});

// ─── 3. Returns empty for unresolved identifier ───────────────────────────────

describe("Returns empty for unresolved identifier", () => {
  it("returns empty array when identifier is not declared", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN unknown_va/*|*/r := 1; END;";
    const edits = rename(sql, "new_name");
    expect(edits).toEqual([]);
  });
});

// ─── 4. Returns empty for non-identifier ──────────────────────────────────────

describe("Returns empty for non-identifier", () => {
  it("returns empty array when cursor is on NULL keyword", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/NULL; END;";
    const edits = rename(sql, "new_name");
    expect(edits).toEqual([]);
  });
});

// ─── 5. Shadowed variable — resolves to inner symbol ─────────────────────────

describe("Shadowed variable — resolves to inner symbol", () => {
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
    const edits = rename(sql, "v_inner");
    expect(edits.length).toBeGreaterThan(0);
  });

  it("every edit has newText === 'v_inner'", () => {
    const edits = rename(sql, "v_inner");
    for (const edit of edits) {
      expect(edit.newText).toBe("v_inner");
    }
  });

  it("the first edit points to the inner v_x declaration (line 5)", () => {
    // The inner v_x is declared on line 5 (0-indexed): "    v_x VARCHAR2(10);"
    const edits = rename(sql, "v_inner");
    expect(edits.length).toBeGreaterThan(0);
    expect(edits[0].range.start.line).toBe(5);
  });

  it("the outer v_x assignment on line 3 is NOT included in edits", () => {
    // Line 3 (0-indexed) is "  v_x := 1;" which references the outer v_x.
    const edits = rename(sql, "v_inner");
    const hasOuterLine = edits.some(e => e.range.start.line === 3);
    expect(hasOuterLine).toBe(false);
  });
});

// ─── 6. prepareRename returns range and placeholder for valid symbol ──────────

describe("prepareRename returns range and placeholder for valid symbol", () => {
  const sql =
    "CREATE PROCEDURE p AS v_count NUMBER; BEGIN v_cou/*|*/nt := 1; END;";

  it("returns non-null", () => {
    const result = prepare(sql);
    expect(result).not.toBeNull();
  });

  it("placeholder is the current identifier name (case-insensitive match to v_count)", () => {
    const result = prepare(sql);
    expect(result).not.toBeNull();
    expect(result!.placeholder.toLowerCase()).toBe("v_count");
  });

  it("range.start.line is >= 0", () => {
    const result = prepare(sql);
    expect(result).not.toBeNull();
    expect(result!.range.start.line).toBeGreaterThanOrEqual(0);
  });

  it("range.start.character is >= 0", () => {
    const result = prepare(sql);
    expect(result).not.toBeNull();
    expect(result!.range.start.character).toBeGreaterThanOrEqual(0);
  });

  it("range end is defined", () => {
    const result = prepare(sql);
    expect(result).not.toBeNull();
    expect(result!.range.end).toBeDefined();
  });

  it("range covers the identifier text v_count", () => {
    const result = prepare(sql);
    expect(result).not.toBeNull();
    const text = sql.replace("/*|*/", "");
    const lines = text.split("\n");
    const lineText = lines[result!.range.start.line];
    const covered = lineText.slice(result!.range.start.character, result!.range.end.character);
    expect(covered.toLowerCase()).toBe("v_count");
  });
});

// ─── 7. prepareRename returns null for unresolved identifier ──────────────────

describe("prepareRename returns null for unresolved identifier", () => {
  it("returns null when identifier is not declared", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN unknown_va/*|*/r := 1; END;";
    const result = prepare(sql);
    expect(result).toBeNull();
  });
});

// ─── 8. All edits have valid line/character ranges ────────────────────────────

describe("All edits have valid line/character ranges", () => {
  const sql = `CREATE PROCEDURE p AS
  v_count NUMBER;
BEGIN
  v_cou/*|*/nt := 1;
  v_count := v_count + 1;
END;`;

  it("result is not empty", () => {
    const edits = rename(sql, "v_total");
    expect(edits.length).toBeGreaterThan(0);
  });

  it("every edit has range.start.line >= 0", () => {
    const edits = rename(sql, "v_total");
    for (const edit of edits) {
      expect(edit.range.start.line).toBeGreaterThanOrEqual(0);
    }
  });

  it("every edit has range.start.character >= 0", () => {
    const edits = rename(sql, "v_total");
    for (const edit of edits) {
      expect(edit.range.start.character).toBeGreaterThanOrEqual(0);
    }
  });

  it("every edit has range.end.line >= range.start.line", () => {
    const edits = rename(sql, "v_total");
    for (const edit of edits) {
      expect(edit.range.end.line).toBeGreaterThanOrEqual(edit.range.start.line);
    }
  });

  it("every edit has range.end.character >= 0", () => {
    const edits = rename(sql, "v_total");
    for (const edit of edits) {
      expect(edit.range.end.character).toBeGreaterThanOrEqual(0);
    }
  });

  it("every edit has range.start and range.end defined", () => {
    const edits = rename(sql, "v_total");
    for (const edit of edits) {
      expect(edit.range.start).toBeDefined();
      expect(edit.range.end).toBeDefined();
    }
  });

  it("every edit has newText defined", () => {
    const edits = rename(sql, "v_total");
    for (const edit of edits) {
      expect(edit.newText).toBeDefined();
    }
  });

  it("the declaration of v_count on line 1 is included in edits", () => {
    // With multi-line SQL, the declaration is on line 1 (0-indexed)
    const edits = rename(sql, "v_total");
    const hasDeclLine = edits.some(e => e.range.start.line === 1);
    expect(hasDeclLine).toBe(true);
  });
});

// ─── 9. Cursor on declaration also works ─────────────────────────────────────

describe("Cursor on declaration also works", () => {
  const sql =
    "CREATE PROCEDURE p AS v_/*|*/x NUMBER; BEGIN v_x := 1; END;";

  it("result is not empty when cursor is on the declaration", () => {
    const edits = rename(sql, "v_new");
    expect(edits.length).toBeGreaterThan(0);
  });

  it("returns at least 1 edit", () => {
    const edits = rename(sql, "v_new");
    expect(edits.length).toBeGreaterThanOrEqual(1);
  });

  it("all edits have newText === 'v_new'", () => {
    const edits = rename(sql, "v_new");
    for (const edit of edits) {
      expect(edit.newText).toBe("v_new");
    }
  });

  it("includes an edit whose range covers the declaration position", () => {
    const text = sql.replace("/*|*/", "");
    const declOffset = text.indexOf("v_x");
    let declLine = 0;
    let lastNl = -1;
    for (let i = 0; i < declOffset; i++) {
      if (text[i] === "\n") { declLine++; lastNl = i; }
    }
    const declChar = declOffset - lastNl - 1;
    const edits = rename(sql, "v_new");
    const hasDecl = edits.some(
      e =>
        e.range.start.line === declLine &&
        e.range.start.character === declChar,
    );
    expect(hasDecl).toBe(true);
  });
});

// ─── 10. Rename cursor ────────────────────────────────────────────────────────

describe("Rename cursor", () => {
  const sql = `CREATE PROCEDURE p AS
  CURSOR c_emp IS SELECT 1 FROM dual;
BEGIN
  OPEN c_em/*|*/p;
  CLOSE c_emp;
END;`;

  it("result is not empty", () => {
    const edits = rename(sql, "c_employees");
    expect(edits.length).toBeGreaterThan(0);
  });

  it("returns at least 1 edit", () => {
    const edits = rename(sql, "c_employees");
    expect(edits.length).toBeGreaterThanOrEqual(1);
  });

  it("all edits have newText === 'c_employees'", () => {
    const edits = rename(sql, "c_employees");
    for (const edit of edits) {
      expect(edit.newText).toBe("c_employees");
    }
  });

  it("includes an edit for the CURSOR declaration (line 1)", () => {
    // The CURSOR c_emp declaration is on line 1 (0-indexed)
    const edits = rename(sql, "c_employees");
    const hasDeclLine = edits.some(e => e.range.start.line === 1);
    expect(hasDeclLine).toBe(true);
  });

  it("declaration edit range covers c_emp", () => {
    const edits = rename(sql, "c_employees");
    const text = sql.replace("/*|*/", "");
    const lines = text.split("\n");
    const declEdit = edits.find(e => e.range.start.line === 1);
    expect(declEdit).toBeDefined();
    const lineText = lines[1];
    const word = lineText.slice(
      declEdit!.range.start.character,
      declEdit!.range.start.character + "c_emp".length,
    );
    expect(word).toBe("c_emp");
  });
});
