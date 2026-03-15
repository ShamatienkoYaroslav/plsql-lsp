import { describe, it, expect } from "vitest";
import { FoldingRangeKind } from "vscode-languageserver/node";
import { parseDocument } from "../src/parser/index";
import { getFoldingRanges } from "../src/folding";

// ─── Helper ────────────────────────────────────────────────────────────────

/** Parse SQL and return the folding ranges for its AST. */
function folding(sql: string) {
  const { ast } = parseDocument(sql);
  return getFoldingRanges(ast);
}

/** Return just the {startLine, endLine} pairs, sorted for stable comparison. */
function lines(sql: string) {
  return folding(sql)
    .map((r) => ({ startLine: r.startLine, endLine: r.endLine }))
    .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Folding Ranges", () => {
  // ── Single-line ────────────────────────────────────────────────────────

  describe("single-line statements produce no ranges", () => {
    it("SELECT on one line emits nothing", () => {
      expect(folding("SELECT 1 FROM dual;")).toHaveLength(0);
    });

    it("INSERT VALUES on one line emits nothing", () => {
      expect(folding("INSERT INTO t (a) VALUES (1);")).toHaveLength(0);
    });

    it("UPDATE on one line emits nothing", () => {
      expect(folding("UPDATE t SET a = 1 WHERE id = 1;")).toHaveLength(0);
    });

    it("DELETE on one line emits nothing", () => {
      expect(folding("DELETE FROM t WHERE id = 1;")).toHaveLength(0);
    });

    it("CREATE TABLE on one line emits nothing", () => {
      expect(folding("CREATE TABLE t (id NUMBER);")).toHaveLength(0);
    });

    it("BEGIN NULL; END on one line emits nothing", () => {
      expect(folding("BEGIN NULL; END;")).toHaveLength(0);
    });
  });

  // ── Range properties ───────────────────────────────────────────────────

  describe("range properties", () => {
    it("every range has startLine strictly less than endLine", () => {
      const ranges = folding(`
        CREATE PROCEDURE check_lines AS
        BEGIN
          NULL;
        END;
      `);
      expect(ranges.length).toBeGreaterThan(0);
      for (const r of ranges) {
        expect(r.startLine).toBeLessThan(r.endLine);
      }
    });

    it("every range has kind FoldingRangeKind.Region", () => {
      const ranges = folding(`
        CREATE PROCEDURE check_kind AS
        BEGIN
          NULL;
        END;
      `);
      expect(ranges.length).toBeGreaterThan(0);
      for (const r of ranges) {
        expect(r.kind).toBe(FoldingRangeKind.Region);
      }
    });

    it("startLine and endLine are non-negative integers", () => {
      const ranges = folding(`
        BEGIN
          NULL;
        END;
      `);
      for (const r of ranges) {
        expect(r.startLine).toBeGreaterThanOrEqual(0);
        expect(r.endLine).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(r.startLine)).toBe(true);
        expect(Number.isInteger(r.endLine)).toBe(true);
      }
    });
  });

  // ── Anonymous blocks ───────────────────────────────────────────────────

  describe("anonymous blocks", () => {
    it("BEGIN/END block spanning multiple lines produces a range", () => {
      const ranges = folding(`
        BEGIN
          NULL;
        END;
      `);
      // AnonymousBlock and Block are both foldable; expect at least one range.
      expect(ranges.length).toBeGreaterThan(0);
      expect(ranges.every((r) => r.startLine < r.endLine)).toBe(true);
    });

    it("DECLARE/BEGIN/END block produces ranges for AnonymousBlock and Block", () => {
      const ranges = folding(`
        DECLARE
          v_x NUMBER;
        BEGIN
          NULL;
        END;
      `);
      // At minimum: AnonymousBlock and Block (inner BEGIN..END) are foldable.
      expect(ranges.length).toBeGreaterThanOrEqual(2);
    });

    it("DECLARE section (Declarations node) is included when multi-line", () => {
      const ranges = folding(`
        DECLARE
          v_a NUMBER;
          v_b VARCHAR2(100);
        BEGIN
          NULL;
        END;
      `);
      // Declarations node spans multiple lines and is foldable.
      expect(ranges.length).toBeGreaterThan(0);
    });
  });

  // ── Procedures ─────────────────────────────────────────────────────────

  describe("procedures", () => {
    it("CREATE PROCEDURE with body produces a range", () => {
      const ranges = folding(`
        CREATE PROCEDURE greet (p_name VARCHAR2) AS
        BEGIN
          NULL;
        END;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("CREATE OR REPLACE PROCEDURE produces a range", () => {
      const ranges = folding(`
        CREATE OR REPLACE PROCEDURE do_stuff AS
        BEGIN
          NULL;
        END;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("procedure with local declarations folds both ProcedureBody and inner Block", () => {
      const ranges = folding(`
        CREATE PROCEDURE count_rows AS
          v_count NUMBER;
          v_name  VARCHAR2(100);
        BEGIN
          NULL;
        END;
      `);
      // ProcedureBody, Block, and Declarations nodes each span multiple lines.
      expect(ranges.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Functions ──────────────────────────────────────────────────────────

  describe("functions", () => {
    it("CREATE FUNCTION with body produces a range", () => {
      const ranges = folding(`
        CREATE FUNCTION add_one (p_val NUMBER) RETURN NUMBER AS
        BEGIN
          RETURN p_val + 1;
        END;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("CREATE OR REPLACE FUNCTION produces a range", () => {
      const ranges = folding(`
        CREATE OR REPLACE FUNCTION multiply (p_a NUMBER, p_b NUMBER) RETURN NUMBER AS
        BEGIN
          RETURN p_a * p_b;
        END;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });
  });

  // ── Packages ───────────────────────────────────────────────────────────

  describe("packages", () => {
    it("CREATE PACKAGE spec produces a range", () => {
      const ranges = folding(`
        CREATE PACKAGE my_pkg AS
          PROCEDURE do_something;
          FUNCTION get_value RETURN NUMBER;
        END my_pkg;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("CREATE OR REPLACE PACKAGE spec produces a range", () => {
      const ranges = folding(`
        CREATE OR REPLACE PACKAGE my_pkg AS
          PROCEDURE do_something;
          FUNCTION get_value RETURN NUMBER;
        END my_pkg;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("CREATE PACKAGE BODY produces a range", () => {
      const ranges = folding(`
        CREATE PACKAGE BODY my_pkg AS
          PROCEDURE do_something AS
          BEGIN
            NULL;
          END;
        END my_pkg;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("package body contains nested ProcedureBody and Block ranges", () => {
      const ranges = folding(`
        CREATE PACKAGE BODY my_pkg AS
          PROCEDURE do_something AS
          BEGIN
            NULL;
          END;
        END my_pkg;
      `);
      // Expect PackageBody, ProcedureBody/Declarations, and Block.
      expect(ranges.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── IF statements ──────────────────────────────────────────────────────

  describe("IF statements", () => {
    it("multi-line IF produces a range", () => {
      const ranges = folding(`
        BEGIN
          IF 1 = 1 THEN
            NULL;
          END IF;
        END;
      `);
      const ifRanges = ranges.filter((r) => {
        // The IfStatement should produce one of the ranges.
        // We verify at least two ranges exist: Block and IfStatement.
        return r.startLine < r.endLine;
      });
      expect(ifRanges.length).toBeGreaterThanOrEqual(2);
    });

    it("IF on a single line produces no IfStatement range", () => {
      // Single-line IF (collapsed) — startLine === endLine, so no range emitted.
      const ranges = folding("BEGIN IF 1=1 THEN NULL; END IF; END;");
      expect(ranges).toHaveLength(0);
    });

    it("IF/ELSIF/ELSE spanning lines produces a range", () => {
      const ranges = folding(`
        BEGIN
          IF x > 0 THEN
            NULL;
          ELSIF x < 0 THEN
            NULL;
          ELSE
            NULL;
          END IF;
        END;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });
  });

  // ── Loops ──────────────────────────────────────────────────────────────

  describe("loops", () => {
    it("basic LOOP spanning lines produces a range", () => {
      const ranges = folding(`
        BEGIN
          LOOP
            EXIT;
          END LOOP;
        END;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("FOR range loop spanning lines produces a range", () => {
      const ranges = folding(`
        BEGIN
          FOR i IN 1..10 LOOP
            NULL;
          END LOOP;
        END;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("WHILE loop spanning lines produces a range", () => {
      const ranges = folding(`
        BEGIN
          WHILE 1 = 1 LOOP
            NULL;
          END LOOP;
        END;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("cursor FOR loop with subquery spanning lines produces a range", () => {
      const ranges = folding(`
        BEGIN
          FOR rec IN (SELECT id, name FROM employees) LOOP
            NULL;
          END LOOP;
        END;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("cursor FOR loop with cursor name spanning lines produces a range", () => {
      const ranges = folding(`
        BEGIN
          FOR rec IN my_cursor LOOP
            NULL;
          END LOOP;
        END;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });
  });

  // ── CASE ───────────────────────────────────────────────────────────────

  describe("CASE statements", () => {
    it("searched CASE spanning lines produces a range", () => {
      const ranges = folding(`
        BEGIN
          CASE
            WHEN 1 = 1 THEN NULL;
            ELSE NULL;
          END CASE;
        END;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("simple CASE spanning lines produces a range", () => {
      const ranges = folding(`
        BEGIN
          CASE x
            WHEN 1 THEN NULL;
            WHEN 2 THEN NULL;
            ELSE NULL;
          END CASE;
        END;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });
  });

  // ── Exception section ──────────────────────────────────────────────────

  describe("exception section", () => {
    it("multi-line EXCEPTION section produces a range", () => {
      const ranges = folding(`
        BEGIN
          NULL;
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("multiple WHEN handlers in exception section produce ranges", () => {
      const ranges = folding(`
        BEGIN
          NULL;
        EXCEPTION
          WHEN NO_DATA_FOUND THEN
            NULL;
          WHEN TOO_MANY_ROWS THEN
            NULL;
          WHEN OTHERS THEN
            NULL;
        END;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });
  });

  // ── DDL ────────────────────────────────────────────────────────────────

  describe("DDL statements", () => {
    it("multi-line CREATE TABLE produces a range", () => {
      const ranges = folding(`
        CREATE TABLE employees (
          id     NUMBER       NOT NULL,
          name   VARCHAR2(100) NOT NULL,
          salary NUMBER
        );
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("multi-line CREATE VIEW produces a range", () => {
      const ranges = folding(`
        CREATE VIEW active_employees AS
          SELECT id, name
          FROM employees
          WHERE active = 1;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("multi-line CREATE INDEX produces a range", () => {
      const ranges = folding(`
        CREATE INDEX idx_emp_name
          ON employees (name);
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });
  });

  // ── DML ────────────────────────────────────────────────────────────────

  describe("DML statements", () => {
    it("multi-line SELECT produces a range", () => {
      const ranges = folding(`
        SELECT id,
               name,
               salary
        FROM employees
        WHERE active = 1;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("multi-line INSERT produces a range", () => {
      const ranges = folding(`
        INSERT INTO employees (id, name, salary)
        VALUES (1, 'Alice', 50000);
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("multi-line UPDATE produces a range", () => {
      const ranges = folding(`
        UPDATE employees
        SET name = 'Bob',
            salary = 60000
        WHERE id = 1;
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("multi-line DELETE produces a range", () => {
      const ranges = folding(`
        DELETE FROM employees
        WHERE active = 0
          AND hire_date < DATE '2000-01-01';
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });

    it("multi-line MERGE produces a range", () => {
      const ranges = folding(`
        MERGE INTO target t
        USING source s ON (t.id = s.id)
        WHEN MATCHED THEN
          UPDATE SET t.name = s.name
        WHEN NOT MATCHED THEN
          INSERT (id, name) VALUES (s.id, s.name);
      `);
      expect(ranges.length).toBeGreaterThan(0);
    });
  });

  // ── Nested folding ─────────────────────────────────────────────────────

  describe("nested folding", () => {
    it("procedure containing IF containing a loop produces multiple ranges", () => {
      const ranges = folding(`
        CREATE PROCEDURE do_nested AS
        BEGIN
          IF 1 = 1 THEN
            FOR i IN 1..10 LOOP
              NULL;
            END LOOP;
          END IF;
        END;
      `);
      // At minimum: ProcedureBody/Block, IfStatement, ForRangeLoop.
      expect(ranges.length).toBeGreaterThanOrEqual(3);
    });

    it("nested loops each produce their own range", () => {
      const outerRangeCount = folding(`
        BEGIN
          FOR i IN 1..5 LOOP
            NULL;
          END LOOP;
        END;
      `).length;

      const nestedRangeCount = folding(`
        BEGIN
          FOR i IN 1..5 LOOP
            FOR j IN 1..5 LOOP
              NULL;
            END LOOP;
          END LOOP;
        END;
      `).length;

      // Nesting adds at least one more range.
      expect(nestedRangeCount).toBeGreaterThan(outerRangeCount);
    });

    it("procedure with exception block folds both the block and the exception section", () => {
      const ranges = folding(`
        CREATE PROCEDURE safe_proc AS
        BEGIN
          NULL;
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
      `);
      // Block (wrapping BEGIN..END) and ExceptionSection are both foldable.
      expect(ranges.length).toBeGreaterThanOrEqual(2);
    });

    it("package body with multiple procedures produces ranges for each body", () => {
      const ranges = folding(`
        CREATE PACKAGE BODY multi_pkg AS
          PROCEDURE first_proc AS
          BEGIN
            NULL;
          END;
          PROCEDURE second_proc AS
          BEGIN
            NULL;
          END;
        END multi_pkg;
      `);
      // PackageBody + two ProcedureBody/Block pairs.
      expect(ranges.length).toBeGreaterThanOrEqual(3);
    });

    it("ranges from nested nodes do not overlap incorrectly — inner endLine <= outer endLine", () => {
      const ranges = folding(`
        CREATE PROCEDURE outer_proc AS
        BEGIN
          FOR i IN 1..10 LOOP
            NULL;
          END LOOP;
        END;
      `);
      // Sort by startLine ascending, then check that no inner range exceeds the outer.
      const sorted = [...ranges].sort((a, b) => a.startLine - b.startLine);
      // The outermost range (earliest startLine) should end no earlier than all others.
      const outermost = sorted[0];
      for (const r of sorted.slice(1)) {
        expect(r.endLine).toBeLessThanOrEqual(outermost.endLine);
      }
    });
  });

  // ── Multiple top-level statements ─────────────────────────────────────

  describe("multiple top-level statements", () => {
    it("two multi-line procedures each contribute ranges", () => {
      const single = folding(`
        CREATE PROCEDURE first_proc AS
        BEGIN
          NULL;
        END;
      `).length;

      const both = folding(`
        CREATE PROCEDURE first_proc AS
        BEGIN
          NULL;
        END;

        CREATE PROCEDURE second_proc AS
        BEGIN
          NULL;
        END;
      `).length;

      expect(both).toBeGreaterThan(single);
    });

    it("mixed DDL and DML only emits ranges for multi-line nodes", () => {
      const ranges = folding(`
        CREATE TABLE t (id NUMBER);
        SELECT 1 FROM dual;
        CREATE TABLE u (
          id   NUMBER,
          name VARCHAR2(100)
        );
      `);
      // Single-line CREATE TABLE and SELECT produce no ranges.
      // Multi-line CREATE TABLE does produce a range.
      expect(ranges.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Line numbers are reasonable ────────────────────────────────────────

  describe("line number accuracy", () => {
    it("folding range for a procedure starts at the CREATE line", () => {
      // The SQL below is not indented so line numbers are predictable.
      // Line 0: "CREATE PROCEDURE p AS"
      // Line 1: "BEGIN"
      // Line 2: "  NULL;"
      // Line 3: "END;"
      const ranges = folding(
        "CREATE PROCEDURE p AS\nBEGIN\n  NULL;\nEND;"
      );
      expect(ranges.length).toBeGreaterThan(0);
      // The outermost ProcedureBody range must start at line 0.
      const outermost = ranges.reduce((a, b) =>
        a.startLine <= b.startLine ? a : b
      );
      expect(outermost.startLine).toBe(0);
    });

    it("folding range for a FOR loop starts at the FOR keyword line", () => {
      // Line 0: "BEGIN"
      // Line 1: "  FOR i IN 1..10 LOOP"
      // Line 2: "    NULL;"
      // Line 3: "  END LOOP;"
      // Line 4: "END;"
      const allRanges = folding(
        "BEGIN\n  FOR i IN 1..10 LOOP\n    NULL;\n  END LOOP;\nEND;"
      );
      const loopRanges = allRanges.filter((r) => r.startLine === 1);
      expect(loopRanges.length).toBeGreaterThanOrEqual(1);
    });

    it("folding range endLine equals the line of the closing keyword", () => {
      // Line 0: "BEGIN"
      // Line 1: "  NULL;"
      // Line 2: "END;"
      const ranges = folding("BEGIN\n  NULL;\nEND;");
      expect(ranges.length).toBeGreaterThan(0);
      // The Block node ends at the line containing END (line 2).
      const blockRange = ranges[0];
      expect(blockRange.endLine).toBe(2);
    });
  });
});
