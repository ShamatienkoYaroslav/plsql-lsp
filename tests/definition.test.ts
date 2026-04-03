import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";
import { getDefinition } from "../src/definition";

// ─── Test helper ──────────────────────────────────────────────────────────────

async function def(sql: string, marker = "/*|*/") {
  const pos = sql.indexOf(marker);
  if (pos === -1) throw new Error("marker not found");
  const text = sql.replace(marker, "");
  const { ast } = parseDocument(text);
  return getDefinition(ast, text, pos);
}

// ─── 1. Variable reference jumps to declaration ───────────────────────────────

describe("Variable reference jumps to declaration", () => {
  const sql = "CREATE PROCEDURE p AS v_count NUMBER; BEGIN v_cou/*|*/nt := 1; END;";

  it("result is not null", async () => {
    expect(await def(sql)).not.toBeNull();
  });

  it("range start points to the declaration of v_count", async () => {
    const result = await def(sql);
    expect(result).not.toBeNull();
    // The text at the returned range start should be at "v_count" in the source
    const text = sql.replace("/*|*/", "");
    const startOffset = result!.range.start;
    // Reconstruct offset from the returned line/character position
    // by finding "v_count" in the declaration section
    const declOffset = text.indexOf("v_count");
    expect(declOffset).toBeGreaterThanOrEqual(0);
    // The character at declOffset should be 'v'
    expect(text[declOffset]).toBe("v");
  });

  it("text at declaration offset starts with v_count", async () => {
    const result = await def(sql);
    expect(result).not.toBeNull();
    const text = sql.replace("/*|*/", "");
    // Find the offset of v_count in source using line/character from result
    const lines = text.split("\n");
    const line = result!.range.start.line;
    const char = result!.range.start.character;
    const lineText = lines[line];
    const word = lineText.slice(char, char + "v_count".length);
    expect(word).toBe("v_count");
  });
});

// ─── 2. Parameter reference jumps to declaration ─────────────────────────────

describe("Parameter reference jumps to declaration", () => {
  const sql = "CREATE PROCEDURE p (p_id IN NUMBER) AS v_x NUMBER; BEGIN v_x := p_i/*|*/d; END;";

  it("result is not null", async () => {
    expect(await def(sql)).not.toBeNull();
  });

  it("range points to the parameter declaration of p_id", async () => {
    const result = await def(sql);
    expect(result).not.toBeNull();
    const text = sql.replace("/*|*/", "");
    const lines = text.split("\n");
    const line = result!.range.start.line;
    const char = result!.range.start.character;
    const word = lines[line].slice(char, char + "p_id".length);
    expect(word).toBe("p_id");
  });
});

// ─── 3. Cursor reference jumps to declaration ────────────────────────────────

describe("Cursor reference jumps to declaration", () => {
  const sql = `CREATE PROCEDURE p AS
  CURSOR c_emp IS SELECT 1 FROM dual;
BEGIN
  OPEN c_em/*|*/p;
END;`;

  it("result is not null", async () => {
    expect(await def(sql)).not.toBeNull();
  });

  it("range points to c_emp in the CURSOR declaration", async () => {
    const result = await def(sql);
    expect(result).not.toBeNull();
    const text = sql.replace("/*|*/", "");
    const lines = text.split("\n");
    const line = result!.range.start.line;
    const char = result!.range.start.character;
    const word = lines[line].slice(char, char + "c_emp".length);
    expect(word).toBe("c_emp");
  });

  it("declaration is on line 1 (the CURSOR declaration line)", async () => {
    const result = await def(sql);
    expect(result).not.toBeNull();
    expect(result!.range.start.line).toBe(1);
  });
});

// ─── 4. Exception reference jumps to declaration ─────────────────────────────

describe("Exception reference jumps to declaration", () => {
  const sql = "CREATE PROCEDURE p AS e_custom EXCEPTION; BEGIN RAISE e_cust/*|*/om; END;";

  it("result is not null", async () => {
    expect(await def(sql)).not.toBeNull();
  });

  it("range points to e_custom declaration", async () => {
    const result = await def(sql);
    expect(result).not.toBeNull();
    const text = sql.replace("/*|*/", "");
    const lines = text.split("\n");
    const line = result!.range.start.line;
    const char = result!.range.start.character;
    const word = lines[line].slice(char, char + "e_custom".length);
    expect(word).toBe("e_custom");
  });
});

// ─── 5. Procedure call jumps to procedure declaration ────────────────────────

describe("Procedure call jumps to procedure declaration", () => {
  const sql = `CREATE PACKAGE BODY pkg AS
  PROCEDURE helper AS BEGIN NULL; END;
  PROCEDURE main AS BEGIN help/*|*/er; END;
END pkg;`;

  it("result is not null", async () => {
    expect(await def(sql)).not.toBeNull();
  });

  it("range points to helper declaration", async () => {
    const result = await def(sql);
    expect(result).not.toBeNull();
    const text = sql.replace("/*|*/", "");
    const lines = text.split("\n");
    const line = result!.range.start.line;
    const char = result!.range.start.character;
    const word = lines[line].slice(char, char + "helper".length);
    expect(word).toBe("helper");
  });

  it("declaration is on line 1 (the helper procedure line)", async () => {
    const result = await def(sql);
    expect(result).not.toBeNull();
    expect(result!.range.start.line).toBe(1);
  });
});

// ─── 6. Nested scope — outer variable ────────────────────────────────────────

describe("Nested scope resolves outer variable", () => {
  const sql = `DECLARE
  v_outer NUMBER;
BEGIN
  DECLARE
    v_inner NUMBER;
  BEGIN
    v_out/*|*/er := 1;
  END;
END;`;

  it("result is not null", async () => {
    expect(await def(sql)).not.toBeNull();
  });

  it("range points to v_outer declaration in outer block", async () => {
    const result = await def(sql);
    expect(result).not.toBeNull();
    const text = sql.replace("/*|*/", "");
    const lines = text.split("\n");
    const line = result!.range.start.line;
    const char = result!.range.start.character;
    const word = lines[line].slice(char, char + "v_outer".length);
    expect(word).toBe("v_outer");
  });

  it("declaration is on line 1 (outer DECLARE section)", async () => {
    const result = await def(sql);
    expect(result).not.toBeNull();
    expect(result!.range.start.line).toBe(1);
  });
});

// ─── 7. Shadowed variable resolves to inner declaration ──────────────────────

describe("Shadowed variable resolves to inner declaration", () => {
  const sql = `DECLARE
  v_x NUMBER;
BEGIN
  DECLARE
    v_x VARCHAR2(10);
  BEGIN
    v_/*|*/x := 'hi';
  END;
END;`;

  it("result is not null", async () => {
    expect(await def(sql)).not.toBeNull();
  });

  it("range points to the inner v_x declaration (line 4)", async () => {
    const result = await def(sql);
    expect(result).not.toBeNull();
    // The inner declaration is on line 4 (0-indexed)
    expect(result!.range.start.line).toBe(4);
  });

  it("declaration character position points to v_x", async () => {
    const result = await def(sql);
    expect(result).not.toBeNull();
    const text = sql.replace("/*|*/", "");
    const lines = text.split("\n");
    const line = result!.range.start.line;
    const char = result!.range.start.character;
    const word = lines[line].slice(char, char + "v_x".length);
    expect(word).toBe("v_x");
  });
});

// ─── 8. FOR loop variable resolves ───────────────────────────────────────────

describe("FOR loop variable resolves", () => {
  const sql =
    "CREATE PROCEDURE p AS v_sum NUMBER; BEGIN FOR i IN 1..10 LOOP v_sum := /*|*/i; END LOOP; END;";

  it("result is not null", async () => {
    expect(await def(sql)).not.toBeNull();
  });
});

// ─── 9. Returns null on non-identifier ───────────────────────────────────────

describe("Returns null on non-identifier", () => {
  it("hovering on NULL keyword returns null", async () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/NULL; END;";
    expect(await def(sql)).toBeNull();
  });
});

// ─── 10. Returns null on unresolved identifier ───────────────────────────────

describe("Returns null on unresolved identifier", () => {
  it("hovering on an undeclared identifier returns null", async () => {
    const sql = "CREATE PROCEDURE p AS BEGIN unknown_va/*|*/r := 1; END;";
    expect(await def(sql)).toBeNull();
  });
});

// ─── 11. Definition range has correct line/character format ──────────────────

describe("Definition range has correct line/character format", () => {
  const sql = `CREATE PROCEDURE p AS
  v_count NUMBER;
BEGIN
  v_cou/*|*/nt := 1;
END;`;

  it("result is not null", async () => {
    expect(await def(sql)).not.toBeNull();
  });

  it("range.start.line is greater than 0 (declaration is not on first line)", async () => {
    const result = await def(sql);
    expect(result).not.toBeNull();
    expect(result!.range.start.line).toBeGreaterThan(0);
  });

  it("range.start.character is >= 0", async () => {
    const result = await def(sql);
    expect(result).not.toBeNull();
    expect(result!.range.start.character).toBeGreaterThanOrEqual(0);
  });

  it("range.end.line and range.end.character are defined", async () => {
    const result = await def(sql);
    expect(result).not.toBeNull();
    expect(result!.range.end.line).toBeDefined();
    expect(result!.range.end.character).toBeDefined();
  });

  it("declaration text at returned position is v_count", async () => {
    const result = await def(sql);
    expect(result).not.toBeNull();
    const text = sql.replace("/*|*/", "");
    const lines = text.split("\n");
    const line = result!.range.start.line;
    const char = result!.range.start.character;
    const word = lines[line].slice(char, char + "v_count".length);
    expect(word).toBe("v_count");
  });
});
