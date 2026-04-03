import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";
import { getSignatureHelp } from "../src/signatureHelp";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function sigHelp(sql: string, marker = "/*|*/") {
  const pos = sql.indexOf(marker);
  if (pos === -1) throw new Error("marker not found");
  const text = sql.replace(marker, "");
  const { ast } = parseDocument(text);
  return getSignatureHelp(ast, text, pos);
}

// ─── 1. Basic procedure call ──────────────────────────────────────────────────

describe("Signature help for procedure call", () => {
  const sql = `CREATE PACKAGE BODY pkg AS
  PROCEDURE helper(p_id IN NUMBER, p_name IN VARCHAR2) AS BEGIN NULL; END;
  PROCEDURE main AS BEGIN helper(/*|*/); END;
END pkg;`;

  it("returns a result", () => {
    expect(sigHelp(sql)).not.toBeNull();
  });

  it("has one signature", () => {
    const result = sigHelp(sql)!;
    expect(result.signatures).toHaveLength(1);
  });

  it("signature label contains the procedure name", () => {
    const result = sigHelp(sql)!;
    expect(result.signatures[0].label).toContain("helper");
  });

  it("signature label contains both parameters", () => {
    const result = sigHelp(sql)!;
    const label = result.signatures[0].label;
    expect(label).toContain("p_id");
    expect(label).toContain("p_name");
  });

  it("has two parameter info entries", () => {
    const result = sigHelp(sql)!;
    expect(result.signatures[0].parameters).toHaveLength(2);
  });

  it("active parameter is 0 (before first arg)", () => {
    const result = sigHelp(sql)!;
    expect(result.activeParameter).toBe(0);
  });
});

// ─── 2. Active parameter advances after comma ────────────────────────────────

describe("Active parameter after comma", () => {
  const sql = `CREATE PACKAGE BODY pkg AS
  PROCEDURE helper(p_id IN NUMBER, p_name IN VARCHAR2) AS BEGIN NULL; END;
  PROCEDURE main AS BEGIN helper(1, /*|*/); END;
END pkg;`;

  it("active parameter is 1 after first comma", () => {
    const result = sigHelp(sql)!;
    expect(result).not.toBeNull();
    expect(result.activeParameter).toBe(1);
  });
});

// ─── 3. Function call ─────────────────────────────────────────────────────────

describe("Signature help for function call", () => {
  const sql = `CREATE PACKAGE BODY pkg AS
  FUNCTION calc(p_a IN NUMBER, p_b IN NUMBER) RETURN NUMBER AS BEGIN RETURN p_a + p_b; END;
  PROCEDURE main AS v_x NUMBER; BEGIN v_x := calc(/*|*/); END;
END pkg;`;

  it("returns a result for function call", () => {
    expect(sigHelp(sql)).not.toBeNull();
  });

  it("signature label contains the function name", () => {
    const result = sigHelp(sql)!;
    expect(result.signatures[0].label).toContain("calc");
  });

  it("has two parameters", () => {
    const result = sigHelp(sql)!;
    expect(result.signatures[0].parameters).toHaveLength(2);
  });
});

// ─── 4. No result outside a call ─────────────────────────────────────────────

describe("No signature help outside a call", () => {
  it("returns null when cursor is not inside a call", () => {
    const sql = `CREATE PROCEDURE p(p_id IN NUMBER) AS BEGIN /*|*/NULL; END;`;
    expect(sigHelp(sql)).toBeNull();
  });
});

// ─── 5. No result for unknown function ───────────────────────────────────────

describe("No signature help for unknown function", () => {
  it("returns null when the called function is not declared", () => {
    const sql = `CREATE PROCEDURE p AS BEGIN unknown_proc(/*|*/); END;`;
    expect(sigHelp(sql)).toBeNull();
  });
});

// ─── 6. Parameter mode and type in label ─────────────────────────────────────

describe("Parameter mode and type appear in signature label", () => {
  const sql = `CREATE PACKAGE BODY pkg AS
  PROCEDURE save(p_id IN NUMBER, p_result OUT VARCHAR2) AS BEGIN NULL; END;
  PROCEDURE main AS v_r VARCHAR2(100); BEGIN save(1, /*|*/v_r); END;
END pkg;`;

  it("label contains IN for p_id", () => {
    const result = sigHelp(sql)!;
    expect(result.signatures[0].label).toContain("p_id IN NUMBER");
  });

  it("label contains OUT for p_result", () => {
    const result = sigHelp(sql)!;
    expect(result.signatures[0].label).toContain("p_result OUT VARCHAR2");
  });
});

// ─── 7. Active parameter clamped to last parameter ──────────────────────────

describe("Active parameter clamped when too many commas", () => {
  const sql = `CREATE PACKAGE BODY pkg AS
  PROCEDURE helper(p_id IN NUMBER) AS BEGIN NULL; END;
  PROCEDURE main AS BEGIN helper(1, /*|*/); END;
END pkg;`;

  it("active parameter is clamped to params.length - 1", () => {
    const result = sigHelp(sql)!;
    expect(result).not.toBeNull();
    expect(result.activeParameter).toBe(0);
  });
});

// ─── 8. Nested parentheses are skipped ──────────────────────────────────────

describe("Nested parentheses are handled", () => {
  const sql = `CREATE PACKAGE BODY pkg AS
  FUNCTION inner_fn RETURN NUMBER AS BEGIN RETURN 1; END;
  PROCEDURE helper(p_id IN NUMBER, p_name IN VARCHAR2) AS BEGIN NULL; END;
  PROCEDURE main AS BEGIN helper(inner_fn(), /*|*/); END;
END pkg;`;

  it("active parameter is 1 after nested call", () => {
    const result = sigHelp(sql)!;
    expect(result).not.toBeNull();
    expect(result.activeParameter).toBe(1);
  });
});

// ─── 9. String literals are skipped ─────────────────────────────────────────

describe("String literals with commas are skipped", () => {
  const sql = `CREATE PACKAGE BODY pkg AS
  PROCEDURE helper(p_id IN NUMBER, p_name IN VARCHAR2) AS BEGIN NULL; END;
  PROCEDURE main AS BEGIN helper('a,b,c', /*|*/); END;
END pkg;`;

  it("active parameter is 1 (commas in string are ignored)", () => {
    const result = sigHelp(sql)!;
    expect(result).not.toBeNull();
    expect(result.activeParameter).toBe(1);
  });
});

// ─── 10. Parameter label offsets are correct ────────────────────────────────

describe("Parameter label offsets", () => {
  const sql = `CREATE PACKAGE BODY pkg AS
  PROCEDURE helper(p_id IN NUMBER, p_name IN VARCHAR2) AS BEGIN NULL; END;
  PROCEDURE main AS BEGIN helper(/*|*/); END;
END pkg;`;

  it("first parameter label offset starts after opening paren", () => {
    const result = sigHelp(sql)!;
    const sig = result.signatures[0];
    const firstParam = sig.parameters![0];
    const [start, end] = firstParam.label as [number, number];
    const extracted = sig.label.slice(start, end);
    expect(extracted).toContain("p_id");
  });

  it("second parameter label offset extracts correctly", () => {
    const result = sigHelp(sql)!;
    const sig = result.signatures[0];
    const secondParam = sig.parameters![1];
    const [start, end] = secondParam.label as [number, number];
    const extracted = sig.label.slice(start, end);
    expect(extracted).toContain("p_name");
  });
});

// ─── 11. No result for procedure with no parameters ─────────────────────────

describe("No signature help for parameterless procedure", () => {
  it("returns null when procedure has no parameters", () => {
    const sql = `CREATE PACKAGE BODY pkg AS
  PROCEDURE helper AS BEGIN NULL; END;
  PROCEDURE main AS BEGIN helper(/*|*/); END;
END pkg;`;
    expect(sigHelp(sql)).toBeNull();
  });
});

// ─── 12. Cursor in middle of first argument ─────────────────────────────────

describe("Cursor in middle of first argument", () => {
  const sql = `CREATE PACKAGE BODY pkg AS
  PROCEDURE helper(p_id IN NUMBER, p_name IN VARCHAR2) AS BEGIN NULL; END;
  PROCEDURE main AS BEGIN helper(12/*|*/3, 'x'); END;
END pkg;`;

  it("active parameter is 0", () => {
    const result = sigHelp(sql)!;
    expect(result).not.toBeNull();
    expect(result.activeParameter).toBe(0);
  });
});
