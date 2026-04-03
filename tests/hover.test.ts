import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";
import { getHover } from "../src/hover";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function hover(sql: string, marker = "/*|*/") {
  const pos = sql.indexOf(marker);
  if (pos === -1) throw new Error("marker not found");
  const text = sql.replace(marker, "");
  const { ast } = parseDocument(text);
  return getHover(ast, text, pos);
}

function hoverContent(sql: string, marker = "/*|*/"): string {
  const result = hover(sql, marker);
  if (!result) return "";
  return typeof result.contents === "string"
    ? result.contents
    : "value" in result.contents
      ? result.contents.value
      : "";
}

// ─── 1. Variable hover shows type ────────────────────────────────────────────

describe("Variable hover shows type", () => {
  const sql = "CREATE PROCEDURE p AS v_count NUMBER; BEGIN v_cou/*|*/nt := 1; END;";

  it("result is not null", () => {
    expect(hover(sql)).not.toBeNull();
  });

  it("content contains the variable name", () => {
    expect(hoverContent(sql)).toContain("v_count");
  });

  it("content contains the data type NUMBER", () => {
    expect(hoverContent(sql)).toContain("NUMBER");
  });

  it("content contains the (variable) label", () => {
    expect(hoverContent(sql)).toContain("(variable)");
  });
});

// ─── 2. Constant hover shows CONSTANT keyword ─────────────────────────────────

describe("Constant hover shows CONSTANT keyword", () => {
  const sql =
    "CREATE PROCEDURE p AS c_max CONSTANT NUMBER := 100; v_x NUMBER; BEGIN v_x := c_m/*|*/ax; END;";

  it("content contains CONSTANT", () => {
    expect(hoverContent(sql)).toContain("CONSTANT");
  });

  it("content contains the data type NUMBER", () => {
    expect(hoverContent(sql)).toContain("NUMBER");
  });

  it("content contains the (constant) label", () => {
    expect(hoverContent(sql)).toContain("(constant)");
  });
});

// ─── 3. Parameter hover shows mode and type ───────────────────────────────────

describe("Parameter hover shows mode and type", () => {
  const sql = "CREATE PROCEDURE p (p_id IN NUMBER) AS v_x NUMBER; BEGIN v_x := p_i/*|*/d; END;";

  it("content contains the mode IN", () => {
    expect(hoverContent(sql)).toContain("IN");
  });

  it("content contains the data type NUMBER", () => {
    expect(hoverContent(sql)).toContain("NUMBER");
  });

  it("content contains the (parameter) label", () => {
    expect(hoverContent(sql)).toContain("(parameter)");
  });
});

// ─── 4. IN OUT parameter hover ───────────────────────────────────────────────

describe("IN OUT parameter hover", () => {
  const sql = "CREATE PROCEDURE p (p_val IN OUT VARCHAR2) AS BEGIN p_v/*|*/al := 'x'; END;";

  it("content contains IN OUT", () => {
    expect(hoverContent(sql)).toContain("IN OUT");
  });

  it("content contains the data type VARCHAR2", () => {
    expect(hoverContent(sql)).toContain("VARCHAR2");
  });
});

// ─── 5. Cursor hover shows SQL ───────────────────────────────────────────────

describe("Cursor hover shows SQL", () => {
  const sql = `CREATE PROCEDURE p AS
  CURSOR c_emp IS SELECT id, name FROM employees;
BEGIN
  OPEN c_em/*|*/p;
END;`;

  it("content contains CURSOR", () => {
    expect(hoverContent(sql)).toContain("CURSOR");
  });

  it("content contains the cursor name c_emp", () => {
    expect(hoverContent(sql)).toContain("c_emp");
  });

  it("content contains SELECT (the cursor SQL)", () => {
    expect(hoverContent(sql)).toContain("SELECT");
  });

  it("content contains the (cursor) label", () => {
    expect(hoverContent(sql)).toContain("(cursor)");
  });
});

// ─── 6. Exception hover ──────────────────────────────────────────────────────

describe("Exception hover", () => {
  const sql = "CREATE PROCEDURE p AS e_custom EXCEPTION; BEGIN RAISE e_cust/*|*/om; END;";

  it("content contains EXCEPTION", () => {
    expect(hoverContent(sql)).toContain("EXCEPTION");
  });

  it("content contains the (exception) label", () => {
    expect(hoverContent(sql)).toContain("(exception)");
  });
});

// ─── 7. Procedure hover ──────────────────────────────────────────────────────

describe("Procedure hover", () => {
  const sql = `CREATE PACKAGE BODY pkg AS
  PROCEDURE helper AS BEGIN NULL; END;
  PROCEDURE main AS BEGIN help/*|*/er; END;
END pkg;`;

  it("content contains PROCEDURE", () => {
    expect(hoverContent(sql)).toContain("PROCEDURE");
  });

  it("content contains the procedure name helper", () => {
    expect(hoverContent(sql)).toContain("helper");
  });

  it("content contains the (procedure) label", () => {
    expect(hoverContent(sql)).toContain("(procedure)");
  });
});

// ─── 8. Function hover ───────────────────────────────────────────────────────

describe("Function hover", () => {
  const sql = `CREATE PACKAGE BODY pkg AS
  FUNCTION calc RETURN NUMBER AS BEGIN RETURN 1; END;
  PROCEDURE main AS v_x NUMBER; BEGIN v_x := cal/*|*/c; END;
END pkg;`;

  it("content contains FUNCTION", () => {
    expect(hoverContent(sql)).toContain("FUNCTION");
  });

  it("content contains the function name calc", () => {
    expect(hoverContent(sql)).toContain("calc");
  });

  it("content contains the (function) label", () => {
    expect(hoverContent(sql)).toContain("(function)");
  });
});

// ─── 9. FOR loop variable hover ──────────────────────────────────────────────

describe("FOR loop variable hover", () => {
  const sql =
    "CREATE PROCEDURE p AS v_sum NUMBER; BEGIN FOR i IN 1..10 LOOP v_sum := /*|*/i; END LOOP; END;";

  it("content contains the loop variable name i", () => {
    expect(hoverContent(sql)).toContain("i");
  });

  it("content contains FOR loop variable indication", () => {
    expect(hoverContent(sql)).toContain("FOR loop");
  });

  it("content contains the (for_loop_variable) label", () => {
    expect(hoverContent(sql)).toContain("(for_loop_variable)");
  });
});

// ─── 10. Returns null when hovering on non-identifier ────────────────────────

describe("Returns null when hovering on non-identifier", () => {
  it("hovering on NULL keyword with no matching symbol returns null", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/NULL; END;";
    // NULL is a keyword; no user-declared symbol named NULL exists
    const result = hover(sql);
    expect(result).toBeNull();
  });
});

// ─── 11. Returns null for unresolved identifier ──────────────────────────────

describe("Returns null for unresolved identifier", () => {
  it("hovering on an undeclared identifier returns null", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN unknown_pk/*|*/g.do_something; END;";
    const result = hover(sql);
    expect(result).toBeNull();
  });
});

// ─── 12. Hover range is correct ──────────────────────────────────────────────

describe("Hover range is correct", () => {
  const sql =
    "CREATE PROCEDURE p AS v_count NUMBER; BEGIN v_count/*|*/ := 1; END;";

  it("result is not null", () => {
    expect(hover(sql)).not.toBeNull();
  });

  it("result has a range property", () => {
    const result = hover(sql);
    expect(result).not.toBeNull();
    expect(result!.range).toBeDefined();
  });

  it("range start character points to the beginning of v_count", () => {
    const result = hover(sql);
    expect(result).not.toBeNull();
    // "v_count" is 7 chars; the cursor is right after it, so wordStart should be 7 chars before wordEnd
    const range = result!.range!;
    expect(range.end.character - range.start.character).toBe("v_count".length);
  });

  it("range start and end are on the same line", () => {
    const result = hover(sql);
    expect(result).not.toBeNull();
    const range = result!.range!;
    expect(range.start.line).toBe(range.end.line);
  });
});

// ─── 13. Scope-aware: shadowed variable shows inner type ─────────────────────

describe("Scope-aware: hovering on shadowed variable shows inner type", () => {
  const sql = `DECLARE
  v_x NUMBER;
BEGIN
  DECLARE
    v_x VARCHAR2(10);
  BEGIN
    v_/*|*/x := 'hi';
  END;
END;`;

  it("content contains VARCHAR2 (inner scope type)", () => {
    expect(hoverContent(sql)).toContain("VARCHAR2");
  });

  it("content does not contain NUMBER (outer scope type should be shadowed)", () => {
    // The inner v_x VARCHAR2(10) shadows the outer v_x NUMBER
    const content = hoverContent(sql);
    // Content should show VARCHAR2, not NUMBER
    expect(content).toContain("VARCHAR2");
    expect(content).not.toContain("NUMBER");
  });
});
