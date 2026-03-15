import { describe, it, expect } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { parseDocument } from "../src/parser/index";

describe("Diagnostics (end-to-end)", () => {
  describe("valid SQL produces no diagnostics", () => {
    it("should produce no diagnostics for valid SELECT", () => {
      expect(parseDocument("SELECT 1 FROM dual;").diagnostics).toEqual([]);
    });

    it("should produce no diagnostics for valid PL/SQL block", () => {
      expect(
        parseDocument(`
          BEGIN
            NULL;
          END;
        `).diagnostics
      ).toEqual([]);
    });

    it("should produce no diagnostics for valid DML", () => {
      expect(parseDocument("INSERT INTO t (a) VALUES (1);").diagnostics).toEqual([]);
    });
  });

  describe("invalid SQL produces diagnostics", () => {
    it("should report diagnostics for incomplete statement", () => {
      const { diagnostics: diags } = parseDocument("SELECT");
      expect(diags.length).toBeGreaterThan(0);
    });

    it("should report diagnostics for unclosed BEGIN block", () => {
      const { diagnostics: diags } = parseDocument("BEGIN NULL;");
      expect(diags.length).toBeGreaterThan(0);
    });

    it("should report diagnostics for unclosed parenthesis", () => {
      const { diagnostics: diags } = parseDocument("SELECT (1 + 2 FROM dual;");
      expect(diags.length).toBeGreaterThan(0);
    });
  });

  describe("multiple statements", () => {
    it("should handle multiple valid statements", () => {
      expect(
        parseDocument(`
          SELECT 1 FROM dual;
          SELECT 2 FROM dual;
        `).diagnostics
      ).toEqual([]);
    });

    it("should handle mix of valid and invalid statements", () => {
      const { diagnostics: diags } = parseDocument(`
        SELECT 1 FROM dual;
        BEGIN NULL;
        SELECT 2 FROM dual;
      `);
      // At least one diagnostic from the unclosed BEGIN block
      expect(diags.length).toBeGreaterThan(0);
    });
  });

  describe("diagnostic properties", () => {
    it("should include line and column in diagnostics", () => {
      const { diagnostics: diags } = parseDocument("BEGIN NULL;");
      expect(diags.length).toBeGreaterThan(0);
      const d = diags[0];
      expect(d.range).toBeDefined();
      expect(d.range.start).toHaveProperty("line");
      expect(d.range.start).toHaveProperty("character");
      expect(d.message).toBeTruthy();
      expect(d.source).toBe("plsql");
    });
  });
});

describe("Unclosed blocks (improved error messages)", () => {
  it("should report 'Unclosed BEGIN' for BEGIN without END", () => {
    const { diagnostics: diags } = parseDocument("BEGIN NULL;");
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toContain("Unclosed BEGIN");
  });

  it("should report a diagnostic for BEGIN IF without END IF", () => {
    // The IF consumes the END but then fails to find the IF keyword, producing
    // an 'Expected IF' error followed by 'Unclosed BEGIN block'.
    const { diagnostics: diags } = parseDocument("BEGIN IF 1=1 THEN NULL; END;");
    expect(diags.length).toBeGreaterThan(0);
    // At least one diagnostic mentions IF or unclosed BEGIN
    const messages = diags.map((d) => d.message);
    expect(messages.some((m) => m.includes("IF") || m.includes("BEGIN"))).toBe(true);
  });

  it("should report a diagnostic for BEGIN LOOP without END LOOP", () => {
    // The END is consumed by the block but LOOP keyword is not found after it.
    const { diagnostics: diags } = parseDocument("BEGIN LOOP EXIT; END;");
    expect(diags.length).toBeGreaterThan(0);
    const messages = diags.map((d) => d.message);
    expect(messages.some((m) => m.includes("LOOP") || m.includes("BEGIN"))).toBe(true);
  });

  it("should report 'Unclosed BEGIN' for BEGIN CASE without END CASE", () => {
    // CASE consumes END but not CASE, leaving BEGIN without its own END.
    const { diagnostics: diags } = parseDocument("BEGIN CASE WHEN 1=1 THEN NULL; END;");
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toContain("Unclosed BEGIN");
  });

  it("should report a diagnostic for BEGIN WHILE LOOP without END LOOP", () => {
    const { diagnostics: diags } = parseDocument("BEGIN WHILE 1=1 LOOP NULL; END;");
    expect(diags.length).toBeGreaterThan(0);
    const messages = diags.map((d) => d.message);
    expect(messages.some((m) => m.includes("LOOP") || m.includes("BEGIN"))).toBe(true);
  });

  it("should report a diagnostic for BEGIN FOR LOOP without END LOOP", () => {
    const { diagnostics: diags } = parseDocument("BEGIN FOR i IN 1..10 LOOP NULL; END;");
    expect(diags.length).toBeGreaterThan(0);
    const messages = diags.map((d) => d.message);
    expect(messages.some((m) => m.includes("LOOP") || m.includes("BEGIN"))).toBe(true);
  });

  it("should report 'Unclosed BEGIN' for DECLARE block without END", () => {
    const { diagnostics: diags } = parseDocument("DECLARE v_x NUMBER; BEGIN NULL;");
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toContain("Unclosed BEGIN");
  });
});

describe("Missing semicolons in PL/SQL", () => {
  it("should warn about missing semicolon between two NULL statements", () => {
    const { diagnostics: diags } = parseDocument("BEGIN NULL NULL; END;");
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toContain("Missing semicolon");
  });

  it("should report the missing-semicolon diagnostic at Warning severity", () => {
    const { diagnostics: diags } = parseDocument("BEGIN NULL NULL; END;");
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Warning);
  });
});

describe("Missing FROM clause", () => {
  it("should report 'Missing FROM' for SELECT with WHERE but no FROM", () => {
    const { diagnostics: diags } = parseDocument("SELECT 1 WHERE 1=1");
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toContain("Missing FROM");
  });

  it("should report 'Missing FROM' for SELECT with GROUP BY but no FROM", () => {
    const { diagnostics: diags } = parseDocument("SELECT col1 GROUP BY col1");
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toContain("Missing FROM");
  });

  it("should report 'Missing FROM' for SELECT with HAVING but no FROM", () => {
    const { diagnostics: diags } = parseDocument("SELECT col1 HAVING COUNT(*) > 1");
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toContain("Missing FROM");
  });

  it("should produce no diagnostic for SELECT without FROM when no other clause is present", () => {
    const { diagnostics: diags } = parseDocument("SELECT 1");
    expect(diags).toEqual([]);
  });
});

describe("Error recovery across multiple statements", () => {
  it("should report unclosed BEGIN but still parse the following SELECT", () => {
    const { diagnostics: diags } = parseDocument("BEGIN NULL; SELECT 1 FROM dual;");
    // The unclosed BEGIN must be reported
    expect(diags.length).toBeGreaterThan(0);
    const msgs = diags.map((d) => d.message);
    expect(msgs.some((m) => m.includes("Unclosed BEGIN") || m.includes("BEGIN"))).toBe(true);
  });

  it("should report multiple diagnostics for two unclosed BEGIN blocks", () => {
    const { diagnostics: diags } = parseDocument("BEGIN NULL; BEGIN NULL;");
    // Expect at least two diagnostics — one per unclosed block
    expect(diags.length).toBeGreaterThanOrEqual(2);
  });
});
