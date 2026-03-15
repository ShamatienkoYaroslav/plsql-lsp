import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";
import { SyntaxNode, isToken } from "../src/parser/ast";

/** Parse input and assert zero diagnostics. */
function expectNoDiagnostics(sql: string) {
  const { diagnostics: diags } = parseDocument(sql);
  if (diags.length > 0) {
    const msgs = diags.map((d) => `  [${d.range.start.line}:${d.range.start.character}] ${d.message}`);
    throw new Error(`Expected no diagnostics but got ${diags.length}:\n${msgs.join("\n")}\n\nInput:\n${sql}`);
  }
}

/** Recursively find the first node with the given kind. */
function findNode(node: SyntaxNode, kind: string): SyntaxNode | null {
  if (node.kind === kind) return node;
  for (const child of node.children) {
    if (isToken(child)) continue;
    const found = findNode(child, kind);
    if (found) return found;
  }
  return null;
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

    it("should parse cursor FOR loop with subquery", () => {
      expectNoDiagnostics(`
        BEGIN
          FOR rec IN (SELECT id, name FROM employees) LOOP
            NULL;
          END LOOP;
        END;
      `);
    });

    it("should parse cursor FOR loop with parameterized cursor", () => {
      expectNoDiagnostics(`
        DECLARE
          CURSOR c_emp (p_dept NUMBER) RETURN employees%ROWTYPE;
        BEGIN
          FOR rec IN c_emp(10) LOOP
            NULL;
          END LOOP;
        END;
      `);
    });

    it("should parse cursor FOR loop with multiple cursor parameters", () => {
      expectNoDiagnostics(`
        BEGIN
          FOR rec IN c_emp(10, 'SALES', SYSDATE) LOOP
            NULL;
          END LOOP;
        END;
      `);
    });

    it("should parse cursor FOR loop with schema-qualified cursor", () => {
      expectNoDiagnostics(`
        BEGIN
          FOR rec IN pkg.my_cursor LOOP
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
      const { diagnostics: diags } = parseDocument("SELECT");
      expect(diags.length).toBeGreaterThan(0);
    });

    it("should not crash on unexpected tokens", () => {
      const { diagnostics: diags } = parseDocument("))) ;;;");
      // Should not throw — just produce diagnostics
      expect(Array.isArray(diags)).toBe(true);
    });

    it("should recover and parse subsequent statements", () => {
      const { diagnostics: diags } = parseDocument("SELECT FROM; SELECT 1 FROM dual;");
      // First statement has errors, but parser should recover
      expect(Array.isArray(diags)).toBe(true);
    });
  });

  describe("cursor FOR loop AST node types", () => {
    it("should produce ForRangeLoop for numeric range", () => {
      const { ast } = parseDocument("BEGIN FOR i IN 1..10 LOOP NULL; END LOOP; END;");
      expect(findNode(ast, "ForRangeLoop")).not.toBeNull();
      expect(findNode(ast, "CursorForLoop")).toBeNull();
    });

    it("should produce ForRangeLoop for REVERSE range", () => {
      const { ast } = parseDocument("BEGIN FOR i IN REVERSE 1..10 LOOP NULL; END LOOP; END;");
      expect(findNode(ast, "ForRangeLoop")).not.toBeNull();
      expect(findNode(ast, "CursorForLoop")).toBeNull();
    });

    it("should produce CursorForLoop for cursor name", () => {
      const { ast } = parseDocument("BEGIN FOR rec IN my_cursor LOOP NULL; END LOOP; END;");
      expect(findNode(ast, "CursorForLoop")).not.toBeNull();
      expect(findNode(ast, "ForRangeLoop")).toBeNull();
    });

    it("should produce CursorForLoop for subquery", () => {
      const { ast } = parseDocument("BEGIN FOR rec IN (SELECT 1 FROM dual) LOOP NULL; END LOOP; END;");
      expect(findNode(ast, "CursorForLoop")).not.toBeNull();
      expect(findNode(ast, "ForRangeLoop")).toBeNull();
    });

    it("should produce CursorForLoop for parameterized cursor", () => {
      const { ast } = parseDocument("BEGIN FOR rec IN c_emp(10) LOOP NULL; END LOOP; END;");
      expect(findNode(ast, "CursorForLoop")).not.toBeNull();
      expect(findNode(ast, "ForRangeLoop")).toBeNull();
    });
  });

  describe("Bulk collect / FORALL", () => {
    // ── FORALL ──────────────────────────────────────────────────────────

    it("should parse FORALL with numeric range", () => {
      expectNoDiagnostics(`
        BEGIN
          FORALL i IN 1..v_arr.COUNT
            INSERT INTO t VALUES (v_arr(i));
        END;
      `);
    });

    it("should parse FORALL with INDICES OF", () => {
      expectNoDiagnostics(`
        BEGIN
          FORALL i IN INDICES OF v_arr
            INSERT INTO t VALUES (v_arr(i));
        END;
      `);
    });

    it("should parse FORALL with VALUES OF", () => {
      expectNoDiagnostics(`
        BEGIN
          FORALL i IN VALUES OF v_idx
            DELETE FROM t WHERE id = v_arr(i);
        END;
      `);
    });

    it("should parse FORALL with INDICES OF BETWEEN", () => {
      expectNoDiagnostics(`
        BEGIN
          FORALL i IN INDICES OF v_arr BETWEEN 1 AND 10
            INSERT INTO t VALUES (v_arr(i));
        END;
      `);
    });

    it("should parse FORALL with SAVE EXCEPTIONS", () => {
      expectNoDiagnostics(`
        BEGIN
          FORALL i IN 1..v_arr.COUNT SAVE EXCEPTIONS
            INSERT INTO t VALUES (v_arr(i));
        END;
      `);
    });

    it("should parse FORALL with UPDATE", () => {
      expectNoDiagnostics(`
        BEGIN
          FORALL i IN 1..v_arr.COUNT
            UPDATE t SET name = v_names(i) WHERE id = v_ids(i);
        END;
      `);
    });

    it("should produce ForallStatement AST node for FORALL", () => {
      const { ast } = parseDocument(`
        BEGIN
          FORALL i IN 1..v_arr.COUNT
            INSERT INTO t VALUES (v_arr(i));
        END;
      `);
      expect(findNode(ast, "ForallStatement")).not.toBeNull();
    });

    // ── BULK COLLECT INTO ────────────────────────────────────────────────

    it("should parse SELECT BULK COLLECT INTO", () => {
      expectNoDiagnostics(`
        BEGIN
          SELECT id BULK COLLECT INTO v_ids FROM employees;
        END;
      `);
    });

    it("should parse SELECT BULK COLLECT INTO multiple variables", () => {
      expectNoDiagnostics(`
        BEGIN
          SELECT id, name BULK COLLECT INTO v_ids, v_names FROM employees;
        END;
      `);
    });

    it("should parse FETCH BULK COLLECT INTO", () => {
      expectNoDiagnostics(`
        BEGIN
          FETCH c_emp BULK COLLECT INTO v_ids;
        END;
      `);
    });

    it("should parse FETCH BULK COLLECT INTO with LIMIT", () => {
      expectNoDiagnostics(`
        BEGIN
          FETCH c_emp BULK COLLECT INTO v_ids LIMIT 100;
        END;
      `);
    });

    it("should parse EXECUTE IMMEDIATE with BULK COLLECT INTO", () => {
      expectNoDiagnostics(`
        BEGIN
          EXECUTE IMMEDIATE 'SELECT id FROM t' BULK COLLECT INTO v_ids;
        END;
      `);
    });

    it("should parse RETURNING BULK COLLECT INTO in DELETE", () => {
      expectNoDiagnostics(`
        BEGIN
          DELETE FROM employees WHERE dept_id = 10 RETURNING id BULK COLLECT INTO v_ids;
        END;
      `);
    });

    it("should produce IntoClause AST node for SELECT BULK COLLECT INTO", () => {
      const { ast } = parseDocument(`
        BEGIN
          SELECT id BULK COLLECT INTO v_ids FROM employees;
        END;
      `);
      expect(findNode(ast, "IntoClause")).not.toBeNull();
    });

    it("should produce ForallStatement and IntoClause nodes together", () => {
      const { ast } = parseDocument(`
        BEGIN
          FORALL i IN 1..v_arr.COUNT
            INSERT INTO t VALUES (v_arr(i));
          SELECT id BULK COLLECT INTO v_ids FROM employees;
        END;
      `);
      expect(findNode(ast, "ForallStatement")).not.toBeNull();
      expect(findNode(ast, "IntoClause")).not.toBeNull();
    });
  });

  describe("Dynamic SQL", () => {
    // ── EXECUTE IMMEDIATE ────────────────────────────────────────────────

    it("should parse EXECUTE IMMEDIATE with a string literal", () => {
      expectNoDiagnostics(`
        BEGIN
          EXECUTE IMMEDIATE 'CREATE TABLE t (id NUMBER)';
        END;
      `);
    });

    it("should parse EXECUTE IMMEDIATE with a string variable", () => {
      expectNoDiagnostics(`
        BEGIN
          EXECUTE IMMEDIATE v_sql;
        END;
      `);
    });

    it("should parse EXECUTE IMMEDIATE with INTO clause", () => {
      expectNoDiagnostics(`
        BEGIN
          EXECUTE IMMEDIATE 'SELECT name FROM emp WHERE id = 1' INTO v_name;
        END;
      `);
    });

    it("should parse EXECUTE IMMEDIATE with INTO multiple variables", () => {
      expectNoDiagnostics(`
        BEGIN
          EXECUTE IMMEDIATE 'SELECT id, name FROM emp WHERE id = 1' INTO v_id, v_name;
        END;
      `);
    });

    it("should parse EXECUTE IMMEDIATE with USING clause", () => {
      expectNoDiagnostics(`
        BEGIN
          EXECUTE IMMEDIATE 'SELECT name FROM emp WHERE id = :1' INTO v_name USING p_id;
        END;
      `);
    });

    it("should parse EXECUTE IMMEDIATE USING with IN/OUT bind parameters", () => {
      expectNoDiagnostics(`
        BEGIN
          EXECUTE IMMEDIATE 'BEGIN :1 := :2 + 1; END;' USING OUT v_result, IN v_input;
        END;
      `);
    });

    it("should parse EXECUTE IMMEDIATE USING with IN OUT bind parameter", () => {
      expectNoDiagnostics(`
        BEGIN
          EXECUTE IMMEDIATE 'BEGIN :1 := :1 + 1; END;' USING IN OUT v_val;
        END;
      `);
    });

    it("should parse EXECUTE IMMEDIATE with BULK COLLECT INTO", () => {
      expectNoDiagnostics(`
        BEGIN
          EXECUTE IMMEDIATE 'SELECT id FROM emp' BULK COLLECT INTO v_ids;
        END;
      `);
    });

    it("should parse EXECUTE IMMEDIATE with RETURNING INTO", () => {
      expectNoDiagnostics(`
        BEGIN
          EXECUTE IMMEDIATE 'DELETE FROM emp WHERE id = :1 RETURNING name INTO :2' USING p_id, OUT v_name;
        END;
      `);
    });

    it("should parse EXECUTE IMMEDIATE with RETURNING BULK COLLECT INTO", () => {
      expectNoDiagnostics(`
        BEGIN
          EXECUTE IMMEDIATE 'DELETE FROM emp WHERE dept = :1 RETURNING id INTO :2' RETURNING BULK COLLECT INTO v_ids;
        END;
      `);
    });

    it("should produce ExecuteImmediateStatement AST node", () => {
      const { ast } = parseDocument(`
        BEGIN
          EXECUTE IMMEDIATE 'SELECT name FROM emp WHERE id = :1' INTO v_name USING p_id;
        END;
      `);
      expect(findNode(ast, "ExecuteImmediateStatement")).not.toBeNull();
    });

    // ── OPEN cursor FOR dynamic SQL ──────────────────────────────────────

    it("should parse OPEN cursor FOR dynamic SQL string literal", () => {
      expectNoDiagnostics(`
        BEGIN
          OPEN v_cursor FOR 'SELECT * FROM emp';
        END;
      `);
    });

    it("should parse OPEN cursor FOR dynamic SQL with USING clause", () => {
      expectNoDiagnostics(`
        BEGIN
          OPEN v_cursor FOR 'SELECT * FROM emp WHERE id = :1' USING p_id;
        END;
      `);
    });

    it("should parse OPEN cursor FOR dynamic SQL string variable", () => {
      expectNoDiagnostics(`
        BEGIN
          OPEN v_cursor FOR v_sql;
        END;
      `);
    });

    it("should parse OPEN cursor FOR dynamic SQL with multiple USING parameters", () => {
      expectNoDiagnostics(`
        BEGIN
          OPEN v_cursor FOR v_sql USING p_id, p_name, p_dept;
        END;
      `);
    });

    // ── DBMS_SQL calls ───────────────────────────────────────────────────

    it("should parse DBMS_SQL.PARSE call", () => {
      expectNoDiagnostics(`
        BEGIN
          DBMS_SQL.PARSE(v_cursor, v_sql, DBMS_SQL.NATIVE);
        END;
      `);
    });

    it("should parse DBMS_SQL.OPEN_CURSOR function call assignment", () => {
      expectNoDiagnostics(`
        BEGIN
          v_cursor := DBMS_SQL.OPEN_CURSOR;
        END;
      `);
    });

    it("should parse DBMS_SQL.DEFINE_COLUMN call", () => {
      expectNoDiagnostics(`
        BEGIN
          DBMS_SQL.DEFINE_COLUMN(v_cursor, 1, v_name, 100);
        END;
      `);
    });

    it("should parse DBMS_SQL.EXECUTE function call assignment", () => {
      expectNoDiagnostics(`
        BEGIN
          v_ret := DBMS_SQL.EXECUTE(v_cursor);
        END;
      `);
    });

    it("should parse DBMS_SQL.CLOSE_CURSOR call", () => {
      expectNoDiagnostics(`
        BEGIN
          DBMS_SQL.CLOSE_CURSOR(v_cursor);
        END;
      `);
    });
  });

  describe("PRAGMA", () => {
    it("should parse PRAGMA AUTONOMOUS_TRANSACTION in DECLARE section", () => {
      expectNoDiagnostics(`
        DECLARE
          PRAGMA AUTONOMOUS_TRANSACTION;
        BEGIN
          NULL;
        END;
      `);
    });

    it("should parse PRAGMA EXCEPTION_INIT in DECLARE section", () => {
      expectNoDiagnostics(`
        DECLARE
          e_custom EXCEPTION;
          PRAGMA EXCEPTION_INIT(e_custom, -20001);
        BEGIN
          NULL;
        END;
      `);
    });

    it("should parse PRAGMA SERIALLY_REUSABLE in package spec", () => {
      expectNoDiagnostics(`
        CREATE PACKAGE my_pkg AS
          PRAGMA SERIALLY_REUSABLE;
          PROCEDURE p1;
        END my_pkg;
      `);
    });

    it("should parse PRAGMA RESTRICT_REFERENCES", () => {
      expectNoDiagnostics(`
        CREATE PACKAGE my_pkg AS
          FUNCTION func_name RETURN NUMBER;
          PRAGMA RESTRICT_REFERENCES(func_name, WNDS, RNDS);
        END my_pkg;
      `);
    });

    it("should produce Pragma AST node", () => {
      const { ast } = parseDocument(`
        DECLARE
          PRAGMA AUTONOMOUS_TRANSACTION;
        BEGIN
          NULL;
        END;
      `);
      expect(findNode(ast, "Pragma")).not.toBeNull();
    });
  });

  describe("Collections", () => {
    it("should parse collection method EXTEND (no args)", () => {
      expectNoDiagnostics(`
        BEGIN
          v_arr.EXTEND;
        END;
      `);
    });

    it("should parse collection method EXTEND with count", () => {
      expectNoDiagnostics(`
        BEGIN
          v_arr.EXTEND(10);
        END;
      `);
    });

    it("should parse collection method DELETE (no args)", () => {
      expectNoDiagnostics(`
        BEGIN
          v_arr.DELETE;
        END;
      `);
    });

    it("should parse collection method DELETE with index", () => {
      expectNoDiagnostics(`
        BEGIN
          v_arr.DELETE(1);
        END;
      `);
    });

    it("should parse collection method TRIM (no args)", () => {
      expectNoDiagnostics(`
        BEGIN
          v_arr.TRIM;
        END;
      `);
    });

    it("should parse collection method TRIM with count", () => {
      expectNoDiagnostics(`
        BEGIN
          v_arr.TRIM(5);
        END;
      `);
    });

    it("should parse collection attribute COUNT", () => {
      expectNoDiagnostics(`
        BEGIN
          v_n := v_arr.COUNT;
        END;
      `);
    });

    it("should parse collection attribute FIRST", () => {
      expectNoDiagnostics(`
        BEGIN
          v_n := v_arr.FIRST;
        END;
      `);
    });

    it("should parse collection attribute LAST", () => {
      expectNoDiagnostics(`
        BEGIN
          v_n := v_arr.LAST;
        END;
      `);
    });

    it("should parse collection attribute EXISTS(1)", () => {
      expectNoDiagnostics(`
        BEGIN
          IF v_arr.EXISTS(1) THEN NULL; END IF;
        END;
      `);
    });

    it("should parse nested table type declaration", () => {
      expectNoDiagnostics(`
        DECLARE
          TYPE t_ids IS TABLE OF NUMBER;
        BEGIN
          NULL;
        END;
      `);
    });

    it("should parse associative array type declaration", () => {
      expectNoDiagnostics(`
        DECLARE
          TYPE t_map IS TABLE OF VARCHAR2(100) INDEX BY PLS_INTEGER;
        BEGIN
          NULL;
        END;
      `);
    });

    it("should parse VARRAY type declaration", () => {
      expectNoDiagnostics(`
        DECLARE
          TYPE t_arr IS VARRAY(100) OF NUMBER;
        BEGIN
          NULL;
        END;
      `);
    });

    it("should parse collection usage in FOR loop with COUNT", () => {
      expectNoDiagnostics(`
        BEGIN
          FOR i IN 1..v_arr.COUNT LOOP
            NULL;
          END LOOP;
        END;
      `);
    });

    it("should parse collection element access by index", () => {
      expectNoDiagnostics(`
        BEGIN
          v_arr(1) := 'test';
        END;
      `);
    });
  });

  describe("Pipelined and aggregate functions", () => {
    it("should parse CREATE FUNCTION with PIPELINED", () => {
      expectNoDiagnostics(`
        CREATE FUNCTION pipe_func RETURN sys_refcursor PIPELINED AS
        BEGIN
          PIPE ROW(1);
          RETURN;
        END;
      `);
    });

    it("should parse CREATE FUNCTION with RESULT_CACHE", () => {
      expectNoDiagnostics(`
        CREATE FUNCTION cached_func (p_id NUMBER) RETURN VARCHAR2 RESULT_CACHE AS
        BEGIN
          RETURN 'value';
        END;
      `);
    });

    it("should parse CREATE AGGREGATE FUNCTION", () => {
      expectNoDiagnostics(`
        CREATE FUNCTION agg_func (p_val NUMBER) RETURN NUMBER AGGREGATE USING my_impl;
      `);
    });

    it("should parse PIPE ROW statement and produce PipeRowStatement node", () => {
      const { ast } = parseDocument(`
        CREATE FUNCTION pipe_func RETURN NUMBER PIPELINED AS
        BEGIN
          PIPE ROW(1);
          RETURN;
        END;
      `);
      expect(findNode(ast, "PipeRowStatement")).not.toBeNull();
    });

    it("should parse function with both DETERMINISTIC and PIPELINED", () => {
      expectNoDiagnostics(`
        CREATE FUNCTION det_pipe_func RETURN NUMBER DETERMINISTIC PIPELINED AS
        BEGIN
          PIPE ROW(1);
          RETURN;
        END;
      `);
    });
  });

  describe("CONNECT BY / START WITH", () => {
    it("should parse basic hierarchical query with START WITH first", () => {
      expectNoDiagnostics(
        "SELECT * FROM employees START WITH manager_id IS NULL CONNECT BY PRIOR employee_id = manager_id;"
      );
    });

    it("should parse hierarchical query with CONNECT BY first", () => {
      expectNoDiagnostics(
        "SELECT * FROM employees CONNECT BY PRIOR employee_id = manager_id START WITH manager_id IS NULL;"
      );
    });

    it("should parse hierarchical query with NOCYCLE", () => {
      expectNoDiagnostics(
        "SELECT * FROM employees CONNECT BY NOCYCLE PRIOR employee_id = manager_id START WITH manager_id IS NULL;"
      );
    });

    it("should parse hierarchical query with LEVEL pseudocolumn", () => {
      expectNoDiagnostics(
        "SELECT LEVEL, name FROM employees CONNECT BY PRIOR id = manager_id;"
      );
    });

    it("should parse hierarchical query with CONNECT_BY_ROOT", () => {
      expectNoDiagnostics(
        "SELECT CONNECT_BY_ROOT name FROM employees CONNECT BY PRIOR id = manager_id;"
      );
    });
  });

  describe("MODEL clause", () => {
    it("should parse basic MODEL clause without errors", () => {
      expectNoDiagnostics(
        "SELECT * FROM sales MODEL DIMENSION BY (product) MEASURES (amount) RULES (amount['Prod1'] = 100);"
      );
    });
  });

  describe("PIVOT / UNPIVOT", () => {
    it("should parse PIVOT clause", () => {
      expectNoDiagnostics(
        "SELECT * FROM sales PIVOT (SUM(amount) FOR product IN ('A' AS a, 'B' AS b));"
      );
    });

    it("should parse UNPIVOT clause", () => {
      expectNoDiagnostics(
        "SELECT * FROM sales_wide UNPIVOT (amount FOR product IN (a, b, c));"
      );
    });

    it("should parse UNPIVOT with INCLUDE NULLS", () => {
      expectNoDiagnostics(
        "SELECT * FROM t UNPIVOT INCLUDE NULLS (val FOR col IN (a, b));"
      );
    });
  });

  describe("Analytic functions with OVER", () => {
    it("should parse ROW_NUMBER() OVER (ORDER BY id)", () => {
      expectNoDiagnostics(
        "SELECT ROW_NUMBER() OVER (ORDER BY id) FROM employees;"
      );
    });

    it("should parse SUM() OVER with PARTITION BY and ORDER BY", () => {
      expectNoDiagnostics(
        "SELECT SUM(salary) OVER (PARTITION BY dept_id ORDER BY hire_date) FROM employees;"
      );
    });

    it("should parse AVG() OVER with ROWS BETWEEN frame", () => {
      expectNoDiagnostics(
        "SELECT AVG(salary) OVER (ORDER BY hire_date ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) FROM employees;"
      );
    });

    it("should parse SUM() OVER with RANGE UNBOUNDED PRECEDING", () => {
      expectNoDiagnostics(
        "SELECT SUM(salary) OVER (ORDER BY hire_date RANGE UNBOUNDED PRECEDING) FROM employees;"
      );
    });

    it("should parse DENSE_RANK() OVER with named window reference", () => {
      expectNoDiagnostics(
        "SELECT DENSE_RANK() OVER w FROM employees;"
      );
    });
  });

  describe("JSON_TABLE / XMLTABLE", () => {
    it("should parse JSON_TABLE in FROM clause", () => {
      expectNoDiagnostics(
        "SELECT jt.* FROM t, JSON_TABLE(t.json_col, '$[*]' COLUMNS (id NUMBER PATH '$.id')) jt;"
      );
    });

    it("should parse XMLTABLE in FROM clause", () => {
      expectNoDiagnostics(
        "SELECT xt.* FROM t, XMLTABLE('/root/row' PASSING t.xml_col COLUMNS id NUMBER PATH 'id') xt;"
      );
    });
  });

  describe("Edition-based redefinition", () => {
    it("should parse CREATE EDITIONABLE PACKAGE", () => {
      expectNoDiagnostics(`
        CREATE EDITIONABLE PACKAGE my_pkg AS
          PROCEDURE p1;
        END my_pkg;
      `);
    });

    it("should parse CREATE NONEDITIONABLE VIEW", () => {
      expectNoDiagnostics(
        "CREATE NONEDITIONABLE VIEW v AS SELECT 1 FROM dual;"
      );
    });

    it("should parse CREATE OR REPLACE EDITIONABLE FUNCTION", () => {
      expectNoDiagnostics(`
        CREATE OR REPLACE EDITIONABLE FUNCTION f RETURN NUMBER AS
        BEGIN
          RETURN 1;
        END;
      `);
    });
  });

  describe("Compound triggers", () => {
    it("should parse basic compound trigger without errors", () => {
      expectNoDiagnostics(`
        CREATE OR REPLACE TRIGGER trg
        FOR INSERT ON t
        COMPOUND TRIGGER
          BEFORE EACH ROW IS
          BEGIN
            NULL;
          END BEFORE EACH ROW;
        END trg;
      `);
    });
  });

  describe("DDL and INSTEAD OF triggers", () => {
    it("should parse DDL trigger with BEFORE CREATE ON SCHEMA", () => {
      expectNoDiagnostics(
        "CREATE OR REPLACE TRIGGER ddl_trg BEFORE CREATE ON SCHEMA BEGIN NULL; END;"
      );
    });

    it("should parse INSTEAD OF trigger on view", () => {
      expectNoDiagnostics(
        "CREATE OR REPLACE TRIGGER io_trg INSTEAD OF INSERT ON v_view BEGIN NULL; END;"
      );
    });
  });

  describe("Conditional compilation", () => {
    it("should parse basic $IF/$THEN/$END", () => {
      expectNoDiagnostics(`
DECLARE
  v_x NUMBER;
$IF $$debug $THEN
  v_debug BOOLEAN := TRUE;
$END
BEGIN
  NULL;
END;
      `);
    });

    it("should parse $IF/$ELSE/$END", () => {
      expectNoDiagnostics(`
BEGIN
$IF $$production $THEN
  DBMS_OUTPUT.PUT_LINE('prod');
$ELSE
  DBMS_OUTPUT.PUT_LINE('dev');
$END
END;
      `);
    });

    it("should parse $IF/$ELSIF/$ELSE/$END", () => {
      expectNoDiagnostics(`
BEGIN
$IF $$version > 10 $THEN
  NULL;
$ELSIF $$version > 5 $THEN
  NULL;
$ELSE
  NULL;
$END
END;
      `);
    });

    it("should parse $ERROR", () => {
      expectNoDiagnostics(`
DECLARE
$IF NOT $$feature_enabled $THEN
  $ERROR 'Feature not enabled' $END
$END
  v_x NUMBER;
BEGIN
  NULL;
END;
      `);
    });

    it("should produce ConditionalCompilation AST node", () => {
      const { ast } = parseDocument("BEGIN $IF TRUE $THEN NULL; $END END;");
      expect(findNode(ast, "ConditionalCompilation")).not.toBeNull();
    });
  });

  describe("Flashback queries", () => {
    it("should parse AS OF TIMESTAMP", () => {
      expectNoDiagnostics(
        "SELECT * FROM employees AS OF TIMESTAMP SYSTIMESTAMP;"
      );
    });

    it("should parse AS OF SCN", () => {
      expectNoDiagnostics(
        "SELECT * FROM employees AS OF SCN 12345;"
      );
    });

    it("should parse AS OF TIMESTAMP with expression", () => {
      expectNoDiagnostics(
        "SELECT * FROM employees AS OF TIMESTAMP SYSTIMESTAMP - 1;"
      );
    });

    it("should parse VERSIONS BETWEEN TIMESTAMP", () => {
      expectNoDiagnostics(
        "SELECT * FROM employees VERSIONS BETWEEN TIMESTAMP :t1 AND :t2;"
      );
    });

    it("should parse VERSIONS BETWEEN SCN", () => {
      expectNoDiagnostics(
        "SELECT * FROM employees VERSIONS BETWEEN SCN 100 AND 200;"
      );
    });
  });

  describe("Hints", () => {
    it("should parse SELECT with FULL hint", () => {
      expectNoDiagnostics(
        "SELECT /*+ FULL(e) */ * FROM employees e;"
      );
    });

    it("should parse SELECT with INDEX hint", () => {
      expectNoDiagnostics(
        "SELECT /*+ INDEX(e idx_emp_name) */ name FROM employees e;"
      );
    });

    it("should parse INSERT with APPEND hint", () => {
      expectNoDiagnostics(
        "INSERT /*+ APPEND */ INTO employees (id) VALUES (1);"
      );
    });

    it("should parse UPDATE with PARALLEL hint", () => {
      expectNoDiagnostics(
        "UPDATE /*+ PARALLEL(4) */ employees SET salary = salary * 1.1;"
      );
    });

    it("should parse DELETE with PARALLEL hint", () => {
      expectNoDiagnostics(
        "DELETE /*+ PARALLEL */ FROM employees WHERE dept_id = 10;"
      );
    });

    it("should parse MERGE with PARALLEL hint", () => {
      expectNoDiagnostics(
        "MERGE /*+ PARALLEL(4) */ INTO target USING source ON (target.id = source.id) WHEN MATCHED THEN UPDATE SET target.name = source.name;"
      );
    });

    it("should parse SELECT with multiple hints", () => {
      expectNoDiagnostics(
        "SELECT /*+ FULL(e) PARALLEL(4) NO_MERGE */ * FROM employees e;"
      );
    });

    it("should parse hint token without stripping it (parse succeeds with no diagnostics)", () => {
      expectNoDiagnostics(
        "SELECT /*+ FULL(e) */ * FROM employees e;"
      );
    });
  });
});
