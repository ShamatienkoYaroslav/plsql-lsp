import { describe, it, expect } from "vitest";
import { TextEdit } from "vscode-languageserver/node";
import { formatDocument } from "../src/formatting";

// ─── Helpers ───────────────────────────────────────────────────────────────

function format(sql: string): TextEdit[] {
  return formatDocument(sql, 4, true);
}

/**
 * Apply a list of TextEdits to a string, returning the resulting string.
 * Edits are applied in reverse document order so that earlier edits do not
 * shift the positions of later ones.
 */
function applyEdits(text: string, edits: TextEdit[]): string {
  const lines = text.split("\n");
  // Apply edits in reverse order to maintain positions
  const sorted = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line)
      return b.range.start.line - a.range.start.line;
    return b.range.start.character - a.range.start.character;
  });
  for (const edit of sorted) {
    const line = lines[edit.range.start.line];
    lines[edit.range.start.line] =
      line.substring(0, edit.range.start.character) +
      edit.newText +
      line.substring(edit.range.end.character);
  }
  return lines.join("\n");
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("formatDocument", () => {
  // ── Already uppercase ───────────────────────────────────────────────────

  describe("already uppercase keywords produce no edits", () => {
    it("SELECT 1 FROM DUAL returns no edits", () => {
      expect(format("SELECT 1 FROM DUAL")).toHaveLength(0);
    });

    it("BEGIN NULL; END; returns no edits", () => {
      expect(format("BEGIN NULL; END;")).toHaveLength(0);
    });

    it("CREATE TABLE employees (emp_id NUMBER) returns no edits", () => {
      expect(format("CREATE TABLE employees (emp_id NUMBER)")).toHaveLength(0);
    });

    it("WHERE clause already uppercase returns no edits", () => {
      expect(format("SELECT emp_id FROM employees WHERE emp_id = 1")).toHaveLength(0);
    });

    it("INSERT INTO already uppercase returns no edits", () => {
      expect(format("INSERT INTO employees (emp_id) VALUES (1)")).toHaveLength(0);
    });

    it("UPDATE SET already uppercase returns no edits", () => {
      expect(format("UPDATE employees SET salary = 50000 WHERE emp_id = 1")).toHaveLength(0);
    });

    it("DELETE FROM already uppercase returns no edits", () => {
      expect(format("DELETE FROM employees WHERE emp_id = 1")).toHaveLength(0);
    });

    it("DECLARE section already uppercase returns no edits", () => {
      expect(format("DECLARE\n  v_x NUMBER;\nBEGIN\n  NULL;\nEND;")).toHaveLength(0);
    });

    it("RETURN already uppercase returns no edits", () => {
      expect(format("CREATE FUNCTION f RETURN NUMBER AS BEGIN RETURN 1; END;")).toHaveLength(0);
    });

    it("CASE WHEN THEN ELSE already uppercase returns no edits", () => {
      expect(format("BEGIN CASE WHEN 1 = 1 THEN NULL; ELSE NULL; END CASE; END;")).toHaveLength(0);
    });
  });

  // ── Lowercase keywords get uppercased ───────────────────────────────────

  describe("lowercase keywords are uppercased", () => {
    it("select → SELECT", () => {
      const edits = format("select 1 from dual");
      const result = applyEdits("select 1 from dual", edits);
      expect(result).toBe("SELECT 1 FROM dual");
    });

    it("from → FROM", () => {
      const edits = format("SELECT 1 from dual");
      const result = applyEdits("SELECT 1 from dual", edits);
      expect(result).toBe("SELECT 1 FROM dual");
    });

    it("where → WHERE", () => {
      const edits = format("SELECT emp_id FROM employees where emp_id = 1");
      const result = applyEdits("SELECT emp_id FROM employees where emp_id = 1", edits);
      expect(result).toBe("SELECT emp_id FROM employees WHERE emp_id = 1");
    });

    it("begin → BEGIN", () => {
      const edits = format("begin NULL; end;");
      const result = applyEdits("begin NULL; end;", edits);
      expect(result).toBe("BEGIN NULL; END;");
    });

    it("end → END", () => {
      const edits = format("BEGIN NULL; end;");
      const result = applyEdits("BEGIN NULL; end;", edits);
      expect(result).toBe("BEGIN NULL; END;");
    });

    it("create → CREATE", () => {
      const edits = format("create TABLE employees (emp_id NUMBER)");
      const result = applyEdits("create TABLE employees (emp_id NUMBER)", edits);
      expect(result).toBe("CREATE TABLE employees (emp_id NUMBER)");
    });

    it("procedure → PROCEDURE", () => {
      const edits = format("CREATE procedure my_proc AS BEGIN NULL; END;");
      const result = applyEdits("CREATE procedure my_proc AS BEGIN NULL; END;", edits);
      expect(result).toBe("CREATE PROCEDURE my_proc AS BEGIN NULL; END;");
    });

    it("function → FUNCTION", () => {
      const edits = format("CREATE function f RETURN NUMBER AS BEGIN RETURN 1; END;");
      const result = applyEdits("CREATE function f RETURN NUMBER AS BEGIN RETURN 1; END;", edits);
      expect(result).toBe("CREATE FUNCTION f RETURN NUMBER AS BEGIN RETURN 1; END;");
    });

    it("package → PACKAGE", () => {
      const edits = format("CREATE package my_pkg AS END my_pkg;");
      const result = applyEdits("CREATE package my_pkg AS END my_pkg;", edits);
      expect(result).toBe("CREATE PACKAGE my_pkg AS END my_pkg;");
    });

    it("if → IF", () => {
      const edits = format("BEGIN if 1=1 THEN NULL; END IF; END;");
      const result = applyEdits("BEGIN if 1=1 THEN NULL; END IF; END;", edits);
      expect(result).toBe("BEGIN IF 1=1 THEN NULL; END IF; END;");
    });

    it("then → THEN", () => {
      const edits = format("BEGIN IF 1=1 then NULL; END IF; END;");
      const result = applyEdits("BEGIN IF 1=1 then NULL; END IF; END;", edits);
      expect(result).toBe("BEGIN IF 1=1 THEN NULL; END IF; END;");
    });

    it("else → ELSE", () => {
      const edits = format("BEGIN IF 1=1 THEN NULL; else NULL; END IF; END;");
      const result = applyEdits("BEGIN IF 1=1 THEN NULL; else NULL; END IF; END;", edits);
      expect(result).toBe("BEGIN IF 1=1 THEN NULL; ELSE NULL; END IF; END;");
    });

    it("loop → LOOP", () => {
      const edits = format("BEGIN loop EXIT; END LOOP; END;");
      const result = applyEdits("BEGIN loop EXIT; END LOOP; END;", edits);
      expect(result).toBe("BEGIN LOOP EXIT; END LOOP; END;");
    });

    it("case → CASE", () => {
      const edits = format("BEGIN case WHEN 1=1 THEN NULL; END CASE; END;");
      const result = applyEdits("BEGIN case WHEN 1=1 THEN NULL; END CASE; END;", edits);
      expect(result).toBe("BEGIN CASE WHEN 1=1 THEN NULL; END CASE; END;");
    });

    it("when → WHEN", () => {
      const edits = format("BEGIN CASE when 1=1 THEN NULL; END CASE; END;");
      const result = applyEdits("BEGIN CASE when 1=1 THEN NULL; END CASE; END;", edits);
      expect(result).toBe("BEGIN CASE WHEN 1=1 THEN NULL; END CASE; END;");
    });

    it("declare → DECLARE", () => {
      const edits = format("declare\n  v_x NUMBER;\nbegin\n  NULL;\nend;");
      const result = applyEdits("declare\n  v_x NUMBER;\nbegin\n  NULL;\nend;", edits);
      expect(result).toBe("DECLARE\n  v_x NUMBER;\nBEGIN\n  NULL;\nEND;");
    });

    it("return → RETURN", () => {
      const edits = format("CREATE FUNCTION f RETURN NUMBER AS BEGIN return 1; END;");
      const result = applyEdits("CREATE FUNCTION f RETURN NUMBER AS BEGIN return 1; END;", edits);
      expect(result).toBe("CREATE FUNCTION f RETURN NUMBER AS BEGIN RETURN 1; END;");
    });

    it("insert into → INSERT INTO", () => {
      const edits = format("insert into employees (emp_id) values (1)");
      const result = applyEdits("insert into employees (emp_id) values (1)", edits);
      expect(result).toBe("INSERT INTO employees (emp_id) VALUES (1)");
    });

    it("update set → UPDATE SET", () => {
      const edits = format("update employees set salary = 50000 where emp_id = 1");
      const result = applyEdits("update employees set salary = 50000 where emp_id = 1", edits);
      expect(result).toBe("UPDATE employees SET salary = 50000 WHERE emp_id = 1");
    });

    it("delete from → DELETE FROM", () => {
      const edits = format("delete from employees where emp_id = 1");
      const result = applyEdits("delete from employees where emp_id = 1", edits);
      expect(result).toBe("DELETE FROM employees WHERE emp_id = 1");
    });
  });

  // ── Mixed case keywords are uppercased ──────────────────────────────────

  describe("mixed-case keywords are uppercased", () => {
    it("Select → SELECT", () => {
      const edits = format("Select 1 From dual");
      const result = applyEdits("Select 1 From dual", edits);
      expect(result).toBe("SELECT 1 FROM dual");
    });

    it("BeGiN → BEGIN", () => {
      const edits = format("BeGiN NULL; EnD;");
      const result = applyEdits("BeGiN NULL; EnD;", edits);
      expect(result).toBe("BEGIN NULL; END;");
    });

    it("Declare → DECLARE", () => {
      const edits = format("Declare\n  v_x NUMBER;\nBegin\n  NULL;\nEnd;");
      const result = applyEdits("Declare\n  v_x NUMBER;\nBegin\n  NULL;\nEnd;", edits);
      expect(result).toBe("DECLARE\n  v_x NUMBER;\nBEGIN\n  NULL;\nEND;");
    });

    it("Create → CREATE, Table → TABLE", () => {
      const edits = format("Create Table employees (emp_id NUMBER)");
      const result = applyEdits("Create Table employees (emp_id NUMBER)", edits);
      expect(result).toBe("CREATE TABLE employees (emp_id NUMBER)");
    });

    it("Procedure → PROCEDURE", () => {
      const sql = "Create Or Replace Procedure my_proc As Begin Null; End;";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toBe("CREATE OR REPLACE PROCEDURE my_proc AS BEGIN NULL; END;");
    });

    it("wHeRe → WHERE", () => {
      const sql = "SELECT emp_id FROM employees wHeRe emp_id = 1";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toBe("SELECT emp_id FROM employees WHERE emp_id = 1");
    });
  });

  // ── Identifiers are NOT uppercased ──────────────────────────────────────

  describe("identifiers are NOT uppercased", () => {
    it("table name preserved", () => {
      const edits = format("SELECT id FROM employees");
      // 'employees' is an identifier — no edit should target it
      const targetTexts = edits.map((e) => e.newText);
      expect(targetTexts).not.toContain("EMPLOYEES");
    });

    it("column name preserved", () => {
      const edits = format("SELECT employee_id FROM t");
      const targetTexts = edits.map((e) => e.newText);
      expect(targetTexts).not.toContain("EMPLOYEE_ID");
    });

    it("variable name in DECLARE preserved", () => {
      const sql = "DECLARE\n  v_count NUMBER;\nBEGIN\n  NULL;\nEND;";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      // v_count should be unchanged
      expect(result).toContain("v_count");
    });

    it("procedure name preserved", () => {
      const sql = "CREATE PROCEDURE my_proc AS BEGIN NULL; END;";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("my_proc");
    });

    it("function name preserved", () => {
      const sql = "CREATE FUNCTION get_value RETURN NUMBER AS BEGIN RETURN 1; END;";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("get_value");
    });

    it("parameter name preserved", () => {
      const sql = "CREATE PROCEDURE p (p_name VARCHAR2) AS BEGIN NULL; END;";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("p_name");
    });

    it("alias name preserved", () => {
      const sql = "SELECT id AS emp_id FROM t";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("emp_id");
    });

    it("mixed-case identifier preserved — camelCase", () => {
      const sql = "SELECT myColumn FROM myTable";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("myColumn");
      expect(result).toContain("myTable");
    });
  });

  // ── Quoted identifiers are NOT modified ─────────────────────────────────

  describe("quoted identifiers are NOT modified", () => {
    it('"myColumn" is unchanged', () => {
      const sql = 'SELECT "myColumn" FROM employees';
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toBe('SELECT "myColumn" FROM employees');
    });

    it('"My Table" quoted identifier with spaces preserved', () => {
      const sql = 'SELECT emp_id FROM "My Table"';
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toBe('SELECT emp_id FROM "My Table"');
    });

    it('"select" as quoted identifier is not uppercased', () => {
      const sql = 'SELECT "select" FROM t';
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      // "select" inside double-quotes is a quoted identifier, must stay lowercase
      expect(result).toContain('"select"');
    });

    it("quoted identifier with mixed case preserved exactly", () => {
      const sql = 'SELECT "FirstName", "LastName" FROM "Employees"';
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain('"FirstName"');
      expect(result).toContain('"LastName"');
      expect(result).toContain('"Employees"');
    });
  });

  // ── String literals are NOT modified ────────────────────────────────────

  describe("string literals are NOT modified", () => {
    it("'hello' string literal unchanged", () => {
      const sql = "SELECT 'hello' FROM dual";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toBe("SELECT 'hello' FROM dual");
    });

    it("string literal with keyword text unchanged", () => {
      const sql = "SELECT 'select from where' FROM dual";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      // The content inside the string literal must not be uppercased
      expect(result).toContain("'select from where'");
    });

    it("mixed-case string content preserved", () => {
      const sql = "SELECT 'Hello World' FROM dual";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("'Hello World'");
    });

    it("empty string literal unchanged", () => {
      const sql = "SELECT '' FROM dual";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("''");
    });

    it("string with embedded apostrophe preserved", () => {
      const sql = "SELECT 'it''s' FROM dual";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("'it''s'");
    });
  });

  // ── Numeric literals are NOT modified ───────────────────────────────────

  describe("numeric literals are NOT modified", () => {
    it("integer literal unchanged", () => {
      const sql = "SELECT 42 FROM dual";
      expect(format(sql)).toHaveLength(0);
    });

    it("decimal literal unchanged", () => {
      const sql = "SELECT 3.14 FROM dual";
      // Only SELECT and FROM should be flagged (already uppercase here)
      expect(format(sql)).toHaveLength(0);
    });

    it("negative numeric in WHERE unchanged", () => {
      const sql = "SELECT id FROM t WHERE salary > 1000";
      const edits = format(sql);
      // 1000 should not appear in any newText
      const texts = edits.map((e) => e.newText);
      expect(texts.every((t) => !/^\d/.test(t))).toBe(true);
    });
  });

  // ── Bind variables are NOT modified ─────────────────────────────────────

  describe("bind variables are NOT modified", () => {
    it(":param is unchanged", () => {
      const sql = "SELECT id FROM t WHERE id = :param";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain(":param");
    });

    it(":1 positional bind unchanged", () => {
      const sql = "SELECT id FROM t WHERE id = :1";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain(":1");
    });

    it(":myBindVar bind variable preserved as-is", () => {
      const sql = "SELECT :myBindVar FROM dual";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain(":myBindVar");
    });

    it("multiple bind variables all preserved", () => {
      const sql = "UPDATE t SET a = :val1 WHERE id = :id1";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain(":val1");
      expect(result).toContain(":id1");
    });
  });

  // ── Operators are NOT modified ───────────────────────────────────────────

  describe("operators and punctuation are NOT modified", () => {
    it("+ operator unchanged", () => {
      const edits = format("SELECT 1 + 2 FROM dual");
      const texts = edits.map((e) => e.newText);
      expect(texts).not.toContain("+");
    });

    it("- operator unchanged", () => {
      const edits = format("SELECT 1 - 2 FROM dual");
      const texts = edits.map((e) => e.newText);
      expect(texts).not.toContain("-");
    });

    it("* unchanged", () => {
      const edits = format("SELECT * FROM t");
      const texts = edits.map((e) => e.newText);
      expect(texts).not.toContain("*");
    });

    it("; unchanged", () => {
      const edits = format("SELECT 1 FROM dual;");
      const texts = edits.map((e) => e.newText);
      expect(texts).not.toContain(";");
    });

    it(". dot operator unchanged", () => {
      const edits = format("SELECT e.name FROM employees e");
      const texts = edits.map((e) => e.newText);
      expect(texts).not.toContain(".");
    });

    it("= comparison operator unchanged", () => {
      const edits = format("SELECT id FROM t WHERE id = 1");
      const texts = edits.map((e) => e.newText);
      expect(texts).not.toContain("=");
    });

    it(":= assignment operator unchanged", () => {
      const edits = format("BEGIN v_x := 1; END;");
      const texts = edits.map((e) => e.newText);
      expect(texts).not.toContain(":=");
    });
  });

  // ── Edit positions are correct ───────────────────────────────────────────

  describe("edit positions are correct", () => {
    it("edit for 'select' on first line has line=0, character=0", () => {
      const edits = format("select 1 FROM dual");
      expect(edits).toHaveLength(1);
      expect(edits[0].range.start.line).toBe(0);
      expect(edits[0].range.start.character).toBe(0);
      expect(edits[0].range.end.character).toBe(6); // "select".length
      expect(edits[0].newText).toBe("SELECT");
    });

    it("edit for 'from' has correct character offset", () => {
      // "SELECT 1 from dual"
      //  0123456789...
      // 'from' starts at character 9
      const edits = format("SELECT 1 from dual");
      expect(edits).toHaveLength(1);
      expect(edits[0].range.start.line).toBe(0);
      expect(edits[0].range.start.character).toBe(9);
      expect(edits[0].range.end.character).toBe(13); // 9 + "from".length
      expect(edits[0].newText).toBe("FROM");
    });

    it("edit range end.character = start.character + keyword.length", () => {
      const edits = format("select id from t where id = 1");
      for (const edit of edits) {
        const len = edit.newText.length;
        expect(edit.range.end.character - edit.range.start.character).toBe(len);
      }
    });

    it("each edit's range start and end are on the same line", () => {
      const edits = format("select id from t where id = 1");
      for (const edit of edits) {
        expect(edit.range.start.line).toBe(edit.range.end.line);
      }
    });
  });

  // ── Empty input ─────────────────────────────────────────────────────────

  describe("empty input", () => {
    it("empty string returns no edits", () => {
      expect(format("")).toHaveLength(0);
    });

    it("whitespace-only string returns no edits", () => {
      expect(format("   \n  \t  ")).toHaveLength(0);
    });

    it("comment-only string returns no edits", () => {
      expect(format("-- just a comment")).toHaveLength(0);
    });
  });

  // ── Multi-line input ─────────────────────────────────────────────────────

  describe("multi-line input", () => {
    it("keyword on second line has line=1", () => {
      // Line 0: "SELECT id"
      // Line 1: "from t"
      const sql = "SELECT id\nfrom t";
      const edits = format(sql);
      const fromEdit = edits.find((e) => e.newText === "FROM");
      expect(fromEdit).toBeDefined();
      expect(fromEdit!.range.start.line).toBe(1);
      expect(fromEdit!.range.start.character).toBe(0);
    });

    it("keyword on third line has line=2", () => {
      // Line 0: "SELECT id"
      // Line 1: "FROM t"
      // Line 2: "where id = 1"
      const sql = "SELECT id\nFROM t\nwhere id = 1";
      const edits = format(sql);
      const whereEdit = edits.find((e) => e.newText === "WHERE");
      expect(whereEdit).toBeDefined();
      expect(whereEdit!.range.start.line).toBe(2);
      expect(whereEdit!.range.start.character).toBe(0);
    });

    it("indented keyword on second line reports correct character offset", () => {
      // Line 0: "BEGIN"
      // Line 1: "  if 1=1 THEN NULL; END IF;"
      // 'if' starts at character 2
      const sql = "BEGIN\n  if 1=1 THEN NULL; END IF;\nEND;";
      const edits = format(sql);
      const ifEdit = edits.find((e) => e.newText === "IF");
      expect(ifEdit).toBeDefined();
      expect(ifEdit!.range.start.line).toBe(1);
      expect(ifEdit!.range.start.character).toBe(2);
    });

    it("multiple lines each with a lowercase keyword produce correct line numbers", () => {
      // Use identifiers that are not keywords to ensure only the SQL keywords
      // produce edits: select/from/where each appear first on their line.
      const sql = "select emp_id\nfrom employees\nwhere emp_id = 1";
      const edits = format(sql);
      // Filter by the three expected keyword edits using their newText
      const selectEdit = edits.find((e) => e.newText === "SELECT");
      const fromEdit = edits.find((e) => e.newText === "FROM");
      const whereEdit = edits.find((e) => e.newText === "WHERE");
      expect(selectEdit?.range.start.line).toBe(0);
      expect(fromEdit?.range.start.line).toBe(1);
      expect(whereEdit?.range.start.line).toBe(2);
    });
  });

  // ── Full PL/SQL blocks ───────────────────────────────────────────────────

  describe("full PL/SQL blocks", () => {
    it("procedure with all lowercase keywords — keywords uppercased, identifiers preserved", () => {
      const sql = [
        "create or replace procedure calculate_bonus (p_emp_id number, p_rate number)",
        "as",
        "  v_salary number;",
        "begin",
        "  select salary into v_salary from employees where emp_id = p_emp_id;",
        "  update employees set bonus = v_salary * p_rate where emp_id = p_emp_id;",
        "  commit;",
        "end calculate_bonus;",
      ].join("\n");

      const edits = format(sql);
      const result = applyEdits(sql, edits);

      // Keywords must be uppercased
      expect(result).toContain("CREATE");
      expect(result).toContain("OR");
      expect(result).toContain("REPLACE");
      expect(result).toContain("PROCEDURE");
      expect(result).toContain("AS");
      expect(result).toContain("BEGIN");
      expect(result).toContain("SELECT");
      expect(result).toContain("INTO");
      expect(result).toContain("FROM");
      expect(result).toContain("WHERE");
      expect(result).toContain("UPDATE");
      expect(result).toContain("SET");
      expect(result).toContain("END");

      // Identifiers must be preserved
      expect(result).toContain("calculate_bonus");
      expect(result).toContain("p_emp_id");
      expect(result).toContain("p_rate");
      expect(result).toContain("v_salary");
      expect(result).toContain("employees");
      expect(result).toContain("emp_id");
      expect(result).toContain("salary");
      expect(result).toContain("bonus");
    });

    it("anonymous block with IF and LOOP — all keywords uppercased", () => {
      const sql = [
        "declare",
        "  v_i number := 0;",
        "begin",
        "  loop",
        "    v_i := v_i + 1;",
        "    if v_i > 10 then",
        "      exit;",
        "    end if;",
        "  end loop;",
        "end;",
      ].join("\n");

      const edits = format(sql);
      const result = applyEdits(sql, edits);

      expect(result).toContain("DECLARE");
      expect(result).toContain("BEGIN");
      expect(result).toContain("LOOP");
      expect(result).toContain("IF");
      expect(result).toContain("THEN");
      expect(result).toContain("EXIT");
      expect(result).toContain("END IF");
      expect(result).toContain("END LOOP");
      expect(result).toContain("END;");

      // identifier preserved
      expect(result).toContain("v_i");
    });

    it("function with CASE expression — keywords uppercased", () => {
      const sql = [
        "create function grade_score (p_score number) return varchar2 as",
        "begin",
        "  return case",
        "    when p_score >= 90 then 'A'",
        "    when p_score >= 80 then 'B'",
        "    else 'F'",
        "  end;",
        "end grade_score;",
      ].join("\n");

      const edits = format(sql);
      const result = applyEdits(sql, edits);

      expect(result).toContain("CREATE");
      expect(result).toContain("FUNCTION");
      expect(result).toContain("RETURN");
      expect(result).toContain("BEGIN");
      expect(result).toContain("CASE");
      expect(result).toContain("WHEN");
      expect(result).toContain("THEN");
      expect(result).toContain("ELSE");
      expect(result).toContain("END");

      // identifier and string literals preserved
      expect(result).toContain("grade_score");
      expect(result).toContain("p_score");
      expect(result).toContain("'A'");
      expect(result).toContain("'B'");
      expect(result).toContain("'F'");
    });

    it("package spec with lowercase — keywords uppercased, member names preserved", () => {
      const sql = [
        "create package employee_pkg as",
        "  procedure hire_employee (p_name varchar2, p_dept number);",
        "  function get_salary (p_id number) return number;",
        "end employee_pkg;",
      ].join("\n");

      const edits = format(sql);
      const result = applyEdits(sql, edits);

      expect(result).toContain("CREATE");
      expect(result).toContain("PACKAGE");
      expect(result).toContain("PROCEDURE");
      expect(result).toContain("FUNCTION");
      expect(result).toContain("RETURN");
      expect(result).toContain("END");

      expect(result).toContain("employee_pkg");
      expect(result).toContain("hire_employee");
      expect(result).toContain("get_salary");
      expect(result).toContain("p_name");
      expect(result).toContain("p_dept");
      expect(result).toContain("p_id");
    });
  });

  // ── DML statements ───────────────────────────────────────────────────────

  describe("DML statements", () => {
    it("SELECT with GROUP BY and HAVING lowercase → uppercased", () => {
      const sql = "select dept_id, count(*) from employees group by dept_id having count(*) > 5";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("SELECT");
      expect(result).toContain("FROM");
      expect(result).toContain("GROUP");
      expect(result).toContain("BY");
      expect(result).toContain("HAVING");
      expect(result).toContain("COUNT");
      // identifiers preserved
      expect(result).toContain("dept_id");
      expect(result).toContain("employees");
    });

    it("SELECT with ORDER BY lowercase → uppercased", () => {
      const sql = "select id from t order by id desc";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("SELECT");
      expect(result).toContain("FROM");
      expect(result).toContain("ORDER");
      expect(result).toContain("BY");
      expect(result).toContain("DESC");
    });

    it("INSERT lowercase → keywords uppercased", () => {
      const sql = "insert into employees (id, name) values (1, 'Alice')";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("INSERT");
      expect(result).toContain("INTO");
      expect(result).toContain("VALUES");
      expect(result).toContain("employees");
      expect(result).toContain("'Alice'");
    });

    it("UPDATE lowercase → keywords uppercased", () => {
      const sql = "update employees set name = 'Bob' where id = 1";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("UPDATE");
      expect(result).toContain("SET");
      expect(result).toContain("WHERE");
      expect(result).toContain("employees");
      expect(result).toContain("'Bob'");
    });

    it("DELETE lowercase → keywords uppercased", () => {
      const sql = "delete from employees where id = 1";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("DELETE");
      expect(result).toContain("FROM");
      expect(result).toContain("WHERE");
      expect(result).toContain("employees");
    });

    it("SELECT with JOIN and ON lowercase → uppercased", () => {
      const sql = "select e.name, d.name from employees e join departments d on e.dept_id = d.id";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("SELECT");
      expect(result).toContain("FROM");
      expect(result).toContain("JOIN");
      expect(result).toContain("ON");
      // identifiers preserved
      expect(result).toContain("employees");
      expect(result).toContain("departments");
    });

    it("SELECT with UNION lowercase → uppercased", () => {
      const sql = "select 1 from dual union select 2 from dual";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("SELECT");
      expect(result).toContain("FROM");
      expect(result).toContain("UNION");
    });

    it("SELECT with IN and NOT IN → keywords uppercased", () => {
      const sql = "select * from t where id in (1, 2) and name not in ('x', 'y')";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("SELECT");
      expect(result).toContain("FROM");
      expect(result).toContain("WHERE");
      expect(result).toContain("IN");
      expect(result).toContain("NOT");
      expect(result).toContain("AND");
    });
  });

  // ── DDL statements ───────────────────────────────────────────────────────

  describe("DDL statements", () => {
    it("CREATE TABLE lowercase → keywords uppercased, column names preserved", () => {
      const sql = "create table employees (emp_id number, emp_name varchar2(100))";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("CREATE");
      expect(result).toContain("TABLE");
      expect(result).toContain("NUMBER");
      // identifiers preserved
      expect(result).toContain("employees");
      expect(result).toContain("emp_id");
      expect(result).toContain("emp_name");
    });

    it("CREATE VIEW lowercase → keywords uppercased", () => {
      const sql = "create view active_emp as select id, name from employees where active = 1";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("CREATE");
      expect(result).toContain("VIEW");
      expect(result).toContain("AS");
      expect(result).toContain("SELECT");
      expect(result).toContain("FROM");
      expect(result).toContain("WHERE");
      // identifiers preserved
      expect(result).toContain("active_emp");
      expect(result).toContain("employees");
    });

    it("CREATE OR REPLACE VIEW lowercase → all keywords uppercased", () => {
      const sql = "create or replace view emp_view as select id from employees";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("CREATE");
      expect(result).toContain("OR");
      expect(result).toContain("REPLACE");
      expect(result).toContain("VIEW");
      expect(result).toContain("AS");
      expect(result).toContain("SELECT");
      expect(result).toContain("FROM");
      expect(result).toContain("emp_view");
      expect(result).toContain("employees");
    });

    it("CREATE INDEX lowercase → keywords uppercased, index name preserved", () => {
      const sql = "create index idx_emp_name on employees (name)";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("CREATE");
      expect(result).toContain("INDEX");
      expect(result).toContain("ON");
      expect(result).toContain("idx_emp_name");
      expect(result).toContain("employees");
    });

    it("CREATE TABLE with NOT NULL and PRIMARY KEY lowercase → uppercased", () => {
      const sql = "create table t (id number not null, primary key (id))";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("CREATE");
      expect(result).toContain("TABLE");
      expect(result).toContain("NOT");
      expect(result).toContain("NULL");
      expect(result).toContain("PRIMARY");
      expect(result).toContain("KEY");
    });

    it("ALTER TABLE lowercase → keywords uppercased", () => {
      const sql = "alter table employees add (email varchar2(200))";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("ALTER");
      expect(result).toContain("TABLE");
      expect(result).toContain("ADD");
      expect(result).toContain("employees");
      expect(result).toContain("email");
    });

    it("DROP TABLE lowercase → keywords uppercased", () => {
      const sql = "drop table employees";
      const edits = format(sql);
      const result = applyEdits(sql, edits);
      expect(result).toContain("DROP");
      expect(result).toContain("TABLE");
      expect(result).toContain("employees");
    });
  });

  // ── Return value shape ────────────────────────────────────────────────────

  describe("return value shape", () => {
    it("returns an array", () => {
      expect(Array.isArray(format("SELECT 1 FROM dual"))).toBe(true);
    });

    it("each edit has range with start/end positions and newText", () => {
      const edits = format("select 1 from dual");
      expect(edits.length).toBeGreaterThan(0);
      for (const edit of edits) {
        expect(edit).toHaveProperty("range");
        expect(edit.range).toHaveProperty("start");
        expect(edit.range).toHaveProperty("end");
        expect(edit.range.start).toHaveProperty("line");
        expect(edit.range.start).toHaveProperty("character");
        expect(edit.range.end).toHaveProperty("line");
        expect(edit.range.end).toHaveProperty("character");
        expect(edit).toHaveProperty("newText");
        expect(typeof edit.newText).toBe("string");
      }
    });

    it("newText is always uppercase for keyword edits", () => {
      const edits = format("select id from t where id = 1");
      for (const edit of edits) {
        expect(edit.newText).toBe(edit.newText.toUpperCase());
      }
    });

    it("no edit is emitted when newText would equal the original text", () => {
      // All tokens that the formatter touches are already uppercase — no edit needed.
      // Use identifiers that are not in the KEYWORDS map to avoid false positives.
      const edits = format("SELECT emp_id FROM employees WHERE emp_id = 1");
      expect(edits).toHaveLength(0);
    });

    it("_tabSize and _insertSpaces parameters are accepted without error", () => {
      // These parameters are part of the API even if currently unused
      expect(() => formatDocument("select 1 from dual", 2, false)).not.toThrow();
      expect(() => formatDocument("select 1 from dual", 4, true)).not.toThrow();
    });
  });
});
