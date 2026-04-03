import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";
import { getCodeLenses } from "../src/codeLens";

function getLenses(sql: string) {
  const { ast } = parseDocument(sql);
  return getCodeLenses(ast, sql, "file:///test.sql");
}

// ─── 1. Basic code lenses ──────────────────────────────────────────────────

describe("Code lenses for procedures/functions", () => {
  it("generates reference count lens for a procedure", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN NULL; END;";
    const lenses = getLenses(sql);
    const refLens = lenses.find(l => l.command?.command === "oradev.showReferences");
    expect(refLens).toBeDefined();
    expect(refLens!.command!.title).toContain("reference");
  });

  it("generates reference count lens for a function", () => {
    const sql = "CREATE FUNCTION f RETURN NUMBER AS BEGIN RETURN 1; END;";
    const lenses = getLenses(sql);
    const refLens = lenses.find(l => l.command?.command === "oradev.showReferences");
    expect(refLens).toBeDefined();
  });

  it("does not generate lenses for variables", () => {
    const sql = "CREATE PROCEDURE p AS v_x NUMBER; BEGIN NULL; END;";
    const lenses = getLenses(sql);
    // All lenses should be for procedure 'p', not for variable 'v_x'
    for (const lens of lenses) {
      expect(lens.command!.arguments).toBeDefined();
      if (lens.command!.arguments!.length >= 3) {
        expect(lens.command!.arguments![2]).not.toBe("v_x");
      }
    }
  });
});

// ─── 2. Reference counting ────────────────────────────────────────────────

describe("Reference counting in code lens", () => {
  it("shows 0 references when procedure is never called", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN NULL; END;";
    const lenses = getLenses(sql);
    const refLens = lenses.find(l => l.command?.command === "oradev.showReferences");
    expect(refLens!.command!.title).toBe("0 references");
  });

  it("counts references correctly", () => {
    const sql = `CREATE PACKAGE BODY pkg AS
  PROCEDURE helper AS BEGIN NULL; END;
  PROCEDURE main AS BEGIN helper; helper; END;
END pkg;`;
    const lenses = getLenses(sql);
    const helperLens = lenses.find(
      l => l.command?.command === "oradev.showReferences" &&
           l.command.arguments?.[2] === "helper",
    );
    expect(helperLens).toBeDefined();
    expect(helperLens!.command!.title).toBe("2 references");
  });

  it("shows singular for 1 reference", () => {
    const sql = `CREATE PACKAGE BODY pkg AS
  PROCEDURE helper AS BEGIN NULL; END;
  PROCEDURE main AS BEGIN helper; END;
END pkg;`;
    const lenses = getLenses(sql);
    const helperLens = lenses.find(
      l => l.command?.command === "oradev.showReferences" &&
           l.command.arguments?.[2] === "helper",
    );
    expect(helperLens).toBeDefined();
    expect(helperLens!.command!.title).toBe("1 reference");
  });
});

// ─── 3. Run lens ──────────────────────────────────────────────────────────

describe("Run lens", () => {
  it("shows Run lens for top-level procedure", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN NULL; END;";
    const lenses = getLenses(sql);
    const runLens = lenses.find(l => l.command?.command === "oradev.runStatement");
    expect(runLens).toBeDefined();
  });

  it("does not show Run lens for package-internal procedure", () => {
    const sql = `CREATE PACKAGE BODY pkg AS
  PROCEDURE helper AS BEGIN NULL; END;
END pkg;`;
    const lenses = getLenses(sql);
    const runLens = lenses.find(l => l.command?.command === "oradev.runStatement");
    expect(runLens).toBeUndefined();
  });
});

// ─── 4. Lens range ────────────────────────────────────────────────────────

describe("Lens range", () => {
  it("lens range points to the procedure name", () => {
    const sql = "CREATE PROCEDURE my_proc AS BEGIN NULL; END;";
    const lenses = getLenses(sql);
    expect(lenses.length).toBeGreaterThan(0);
    // All lenses for my_proc should have the same range pointing to the name
    const refLens = lenses.find(l => l.command?.command === "oradev.showReferences");
    expect(refLens!.range.start.line).toBe(0);
    expect(refLens!.range.start.character).toBe(sql.indexOf("my_proc"));
  });
});
