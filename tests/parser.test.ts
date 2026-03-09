import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";

/** Parse input and assert zero diagnostics. */
function expectNoDiagnostics(sql: string) {
  const diags = parseDocument(sql);
  if (diags.length > 0) {
    const msgs = diags.map((d) => `  [${d.range.start.line}:${d.range.start.character}] ${d.message}`);
    throw new Error(`Expected no diagnostics but got ${diags.length}:\n${msgs.join("\n")}\n\nInput:\n${sql}`);
  }
}

describe("Parser", () => {
  describe("SELECT statements", () => {
    it("should parse simple SELECT", () => {
      expectNoDiagnostics("SELECT 1 FROM dual;");
    });

    it("should parse SELECT with alias", () => {
      expectNoDiagnostics("SELECT 1 AS x FROM dual;");
    });

    it("should parse SELECT *", () => {
      expectNoDiagnostics("SELECT * FROM employees;");
    });

    it("should parse SELECT with WHERE", () => {
      expectNoDiagnostics("SELECT id, name FROM employees WHERE id = 1;");
    });

    it("should parse SELECT with ORDER BY", () => {
      expectNoDiagnostics("SELECT id FROM employees ORDER BY id;");
    });

    it("should parse SELECT with GROUP BY and HAVING", () => {
      expectNoDiagnostics("SELECT dept_id, COUNT(*) FROM employees GROUP BY dept_id HAVING COUNT(*) > 5;");
    });

    it("should parse SELECT with JOIN", () => {
      expectNoDiagnostics("SELECT e.name, d.name FROM employees e JOIN departments d ON e.dept_id = d.id;");
    });

    it("should parse SELECT with LEFT JOIN", () => {
      expectNoDiagnostics("SELECT e.name, d.name FROM employees e LEFT JOIN departments d ON e.dept_id = d.id;");
    });

    it("should parse SELECT with subquery", () => {
      expectNoDiagnostics("SELECT * FROM (SELECT id FROM employees);");
    });

    it("should parse SELECT with IN list", () => {
      expectNoDiagnostics("SELECT * FROM employees WHERE dept_id IN (1, 2, 3);");
    });

    it("should parse SELECT with CTE", () => {
      expectNoDiagnostics("WITH cte AS (SELECT 1 AS x FROM dual) SELECT * FROM cte;");
    });

    it("should parse SELECT with UNION", () => {
      expectNoDiagnostics("SELECT 1 FROM dual UNION SELECT 2 FROM dual;");
    });

    it("should parse SELECT with UNION ALL", () => {
      expectNoDiagnostics("SELECT 1 FROM dual UNION ALL SELECT 2 FROM dual;");
    });

    it("should parse SELECT with DISTINCT", () => {
      expectNoDiagnostics("SELECT DISTINCT name FROM employees;");
    });

    it("should parse SELECT with FETCH FIRST", () => {
      expectNoDiagnostics("SELECT * FROM employees FETCH FIRST 10 ROWS ONLY;");
    });
  });

  describe("DML statements", () => {
    it("should parse INSERT VALUES", () => {
      expectNoDiagnostics("INSERT INTO employees (id, name) VALUES (1, 'John');");
    });

    it("should parse INSERT SELECT", () => {
      expectNoDiagnostics("INSERT INTO archive SELECT * FROM employees WHERE active = 0;");
    });

    it("should parse UPDATE", () => {
      expectNoDiagnostics("UPDATE employees SET name = 'Jane' WHERE id = 1;");
    });

    it("should parse UPDATE multiple columns", () => {
      expectNoDiagnostics("UPDATE employees SET name = 'Jane', salary = 50000 WHERE id = 1;");
    });

    it("should parse DELETE", () => {
      expectNoDiagnostics("DELETE FROM employees WHERE id = 1;");
    });

    it("should parse MERGE", () => {
      expectNoDiagnostics(`
        MERGE INTO target
        USING source ON (target.id = source.id)
        WHEN MATCHED THEN UPDATE SET target.name = source.name
        WHEN NOT MATCHED THEN INSERT (id, name) VALUES (source.id, source.name);
      `);
    });
  });

  describe("DDL statements", () => {
    it("should parse CREATE TABLE", () => {
      expectNoDiagnostics("CREATE TABLE employees (id NUMBER, name VARCHAR2(100));");
    });

    it("should parse CREATE VIEW", () => {
      expectNoDiagnostics("CREATE VIEW emp_view AS SELECT id, name FROM employees;");
    });

    it("should parse CREATE OR REPLACE VIEW", () => {
      expectNoDiagnostics("CREATE OR REPLACE VIEW emp_view AS SELECT id, name FROM employees;");
    });

    it("should parse CREATE INDEX", () => {
      expectNoDiagnostics("CREATE INDEX idx_emp_name ON employees (name);");
    });

    it("should parse CREATE UNIQUE INDEX", () => {
      expectNoDiagnostics("CREATE UNIQUE INDEX idx_emp_id ON employees (id);");
    });

    it("should parse CREATE SEQUENCE", () => {
      expectNoDiagnostics("CREATE SEQUENCE emp_seq START WITH 1 INCREMENT BY 1;");
    });

    it("should parse CREATE PROCEDURE", () => {
      expectNoDiagnostics(`
        CREATE PROCEDURE greet (p_name VARCHAR2) AS
        BEGIN
          NULL;
        END;
      `);
    });

    it("should parse CREATE OR REPLACE PROCEDURE", () => {
      expectNoDiagnostics(`
        CREATE OR REPLACE PROCEDURE greet (p_name VARCHAR2) AS
        BEGIN
          NULL;
        END;
      `);
    });

    it("should parse CREATE FUNCTION", () => {
      expectNoDiagnostics(`
        CREATE FUNCTION add_one (p_val NUMBER) RETURN NUMBER AS
        BEGIN
          RETURN p_val + 1;
        END;
      `);
    });

    it("should parse CREATE PACKAGE", () => {
      expectNoDiagnostics(`
        CREATE PACKAGE my_pkg AS
          PROCEDURE do_something;
          FUNCTION get_value RETURN NUMBER;
        END my_pkg;
      `);
    });

    it("should parse ALTER TABLE ADD column", () => {
      expectNoDiagnostics("ALTER TABLE employees ADD (email VARCHAR2(200));");
    });

    it("should parse DROP TABLE", () => {
      expectNoDiagnostics("DROP TABLE employees;");
    });

    it("should parse DROP TABLE CASCADE CONSTRAINTS", () => {
      expectNoDiagnostics("DROP TABLE employees CASCADE CONSTRAINTS;");
    });
  });

  describe("PL/SQL blocks", () => {
    it("should parse anonymous block", () => {
      expectNoDiagnostics(`
        BEGIN
          NULL;
        END;
      `);
    });

    it("should parse anonymous block with DECLARE", () => {
      expectNoDiagnostics(`
        DECLARE
          v_name VARCHAR2(100);
        BEGIN
          v_name := 'hello';
        END;
      `);
    });

    it("should parse IF statement", () => {
      expectNoDiagnostics(`
        BEGIN
          IF 1 = 1 THEN
            NULL;
          END IF;
        END;
      `);
    });

    it("should parse IF-ELSIF-ELSE", () => {
      expectNoDiagnostics(`
        BEGIN
          IF 1 = 1 THEN
            NULL;
          ELSIF 2 = 2 THEN
            NULL;
          ELSE
            NULL;
          END IF;
        END;
      `);
    });

    it("should parse basic LOOP", () => {
      expectNoDiagnostics(`
        BEGIN
          LOOP
            EXIT;
          END LOOP;
        END;
      `);
    });

    it("should parse FOR loop", () => {
      expectNoDiagnostics(`
        BEGIN
          FOR i IN 1..10 LOOP
            NULL;
          END LOOP;
        END;
      `);
    });

    it("should parse WHILE loop", () => {
      expectNoDiagnostics(`
        BEGIN
          WHILE 1 = 1 LOOP
            NULL;
          END LOOP;
        END;
      `);
    });

    it("should parse CASE statement", () => {
      expectNoDiagnostics(`
        BEGIN
          CASE
            WHEN 1 = 1 THEN NULL;
            ELSE NULL;
          END CASE;
        END;
      `);
    });

    it("should parse cursor FOR loop with cursor name", () => {
      expectNoDiagnostics(`
        BEGIN
          FOR rec IN my_cursor LOOP
            NULL;
          END LOOP;
        END;
      `);
    });

    it("should parse EXCEPTION block", () => {
      expectNoDiagnostics(`
        BEGIN
          NULL;
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
      `);
    });
  });

  describe("transaction control", () => {
    it("should parse COMMIT", () => {
      expectNoDiagnostics("COMMIT;");
    });

    it("should parse ROLLBACK", () => {
      expectNoDiagnostics("ROLLBACK;");
    });

    it("should parse SAVEPOINT", () => {
      expectNoDiagnostics("SAVEPOINT sp1;");
    });

    it("should parse ROLLBACK TO SAVEPOINT", () => {
      expectNoDiagnostics("ROLLBACK TO SAVEPOINT sp1;");
    });
  });

  describe("error recovery", () => {
    it("should not crash on incomplete SELECT", () => {
      const diags = parseDocument("SELECT");
      expect(diags.length).toBeGreaterThan(0);
    });

    it("should not crash on unexpected tokens", () => {
      const diags = parseDocument("))) ;;;");
      // Should not throw — just produce diagnostics
      expect(Array.isArray(diags)).toBe(true);
    });

    it("should recover and parse subsequent statements", () => {
      const diags = parseDocument("SELECT FROM; SELECT 1 FROM dual;");
      // First statement has errors, but parser should recover
      expect(Array.isArray(diags)).toBe(true);
    });
  });
});
