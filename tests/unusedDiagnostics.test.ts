import { describe, it, expect } from "vitest";
import { DiagnosticSeverity, DiagnosticTag } from "vscode-languageserver/node";
import { parseDocument } from "../src/parser/index";
import { getUnusedDiagnostics } from "../src/unusedDiagnostics";

function getUnused(text: string) {
  const { ast } = parseDocument(text);
  return getUnusedDiagnostics(ast);
}

function unusedNames(text: string): string[] {
  return getUnused(text).map((d) => {
    const match = d.message.match(/^'(.+)' is declared but never used$/);
    return match ? match[1] : d.message;
  });
}

describe("Unused variable diagnostics", () => {
  describe("basic unused detection", () => {
    it("should flag an unused variable", () => {
      const diags = getUnused(`
        DECLARE
          v_unused NUMBER;
        BEGIN
          NULL;
        END;
      `);
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toBe("'v_unused' is declared but never used");
      expect(diags[0].severity).toBe(DiagnosticSeverity.Hint);
      expect(diags[0].tags).toEqual([DiagnosticTag.Unnecessary]);
      expect(diags[0].source).toBe("plsql");
    });

    it("should flag an unused constant", () => {
      const names = unusedNames(`
        DECLARE
          c_val CONSTANT NUMBER := 42;
        BEGIN
          NULL;
        END;
      `);
      expect(names).toContain("c_val");
    });

    it("should flag an unused parameter", () => {
      const names = unusedNames(`
        CREATE OR REPLACE PROCEDURE my_proc(p_id NUMBER)
        IS
        BEGIN
          NULL;
        END;
      `);
      expect(names).toContain("p_id");
    });

    it("should not flag a used variable", () => {
      const diags = getUnused(`
        DECLARE
          v_count NUMBER;
        BEGIN
          v_count := 1;
        END;
      `);
      expect(diags).toHaveLength(0);
    });

    it("should not flag a used parameter", () => {
      const diags = getUnused(`
        CREATE OR REPLACE PROCEDURE my_proc(p_id NUMBER)
        IS
          v_local NUMBER;
        BEGIN
          v_local := p_id;
        END;
      `);
      // p_id is used, v_local is used (assigned from p_id)
      // Actually v_local is used on the left side of assignment — check if that counts as a reference
      // The reference resolution visits identifiers; assignment targets are still references
      expect(unusedNames(`
        CREATE OR REPLACE PROCEDURE my_proc(p_id NUMBER)
        IS
          v_local NUMBER;
        BEGIN
          v_local := p_id;
        END;
      `)).toEqual([]);
    });
  });

  describe("should NOT flag non-checkable symbol types", () => {
    it("should not flag unused cursors", () => {
      const names = unusedNames(`
        DECLARE
          CURSOR c_emp IS SELECT 1 FROM dual;
        BEGIN
          NULL;
        END;
      `);
      expect(names).not.toContain("c_emp");
    });

    it("should not flag unused exceptions", () => {
      const names = unusedNames(`
        DECLARE
          e_custom EXCEPTION;
        BEGIN
          NULL;
        END;
      `);
      expect(names).not.toContain("e_custom");
    });

    it("should not flag unused procedures", () => {
      const names = unusedNames(`
        CREATE OR REPLACE PACKAGE BODY my_pkg IS
          PROCEDURE helper IS
          BEGIN
            NULL;
          END;
        END;
      `);
      expect(names).not.toContain("helper");
    });

    it("should not flag unused functions", () => {
      const names = unusedNames(`
        CREATE OR REPLACE PACKAGE BODY my_pkg IS
          FUNCTION calc RETURN NUMBER IS
          BEGIN
            RETURN 1;
          END;
        END;
      `);
      expect(names).not.toContain("calc");
    });

    it("should not flag unused types", () => {
      const names = unusedNames(`
        DECLARE
          TYPE t_arr IS TABLE OF NUMBER;
        BEGIN
          NULL;
        END;
      `);
      expect(names).not.toContain("t_arr");
    });

    it("should not flag for-loop variables", () => {
      const names = unusedNames(`
        BEGIN
          FOR i IN 1..10 LOOP
            NULL;
          END LOOP;
        END;
      `);
      expect(names).not.toContain("i");
    });
  });

  describe("multiple declarations", () => {
    it("should flag only unused among multiple variables", () => {
      const names = unusedNames(`
        DECLARE
          v_used NUMBER;
          v_unused VARCHAR2(100);
        BEGIN
          v_used := 1;
        END;
      `);
      expect(names).toContain("v_unused");
      expect(names).not.toContain("v_used");
    });

    it("should flag multiple unused variables", () => {
      const names = unusedNames(`
        DECLARE
          a NUMBER;
          b NUMBER;
          c NUMBER;
        BEGIN
          NULL;
        END;
      `);
      expect(names).toHaveLength(3);
      expect(names).toContain("a");
      expect(names).toContain("b");
      expect(names).toContain("c");
    });
  });

  describe("nested scopes", () => {
    it("should flag unused variable in nested block", () => {
      const names = unusedNames(`
        CREATE OR REPLACE PROCEDURE outer_proc IS
          v_outer NUMBER;
        BEGIN
          v_outer := 1;
          DECLARE
            v_inner NUMBER;
          BEGIN
            NULL;
          END;
        END;
      `);
      expect(names).toContain("v_inner");
      expect(names).not.toContain("v_outer");
    });
  });

  describe("case insensitivity", () => {
    it("should recognize usage regardless of case", () => {
      const diags = getUnused(`
        DECLARE
          My_Var NUMBER;
        BEGIN
          MY_VAR := 1;
        END;
      `);
      expect(diags).toHaveLength(0);
    });
  });

  describe("diagnostic properties", () => {
    it("should have correct range pointing to the name", () => {
      const diags = getUnused(`
        DECLARE
          v_test NUMBER;
        BEGIN
          NULL;
        END;
      `);
      expect(diags).toHaveLength(1);
      const d = diags[0];
      // Range should point to the identifier, not the whole declaration
      expect(d.range.start.line).toBe(d.range.end.line);
    });
  });
});
