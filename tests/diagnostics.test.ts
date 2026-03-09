import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";

describe("Diagnostics (end-to-end)", () => {
  describe("valid SQL produces no diagnostics", () => {
    it("should produce no diagnostics for valid SELECT", () => {
      expect(parseDocument("SELECT 1 FROM dual;")).toEqual([]);
    });

    it("should produce no diagnostics for valid PL/SQL block", () => {
      expect(
        parseDocument(`
          BEGIN
            NULL;
          END;
        `)
      ).toEqual([]);
    });

    it("should produce no diagnostics for valid DML", () => {
      expect(parseDocument("INSERT INTO t (a) VALUES (1);")).toEqual([]);
    });
  });

  describe("invalid SQL produces diagnostics", () => {
    it("should report diagnostics for incomplete statement", () => {
      const diags = parseDocument("SELECT");
      expect(diags.length).toBeGreaterThan(0);
    });

    it("should report diagnostics for unclosed BEGIN block", () => {
      const diags = parseDocument("BEGIN NULL;");
      expect(diags.length).toBeGreaterThan(0);
    });

    it("should report diagnostics for unclosed parenthesis", () => {
      const diags = parseDocument("SELECT (1 + 2 FROM dual;");
      expect(diags.length).toBeGreaterThan(0);
    });
  });

  describe("multiple statements", () => {
    it("should handle multiple valid statements", () => {
      expect(
        parseDocument(`
          SELECT 1 FROM dual;
          SELECT 2 FROM dual;
        `)
      ).toEqual([]);
    });

    it("should handle mix of valid and invalid statements", () => {
      const diags = parseDocument(`
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
      const diags = parseDocument("BEGIN NULL;");
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
