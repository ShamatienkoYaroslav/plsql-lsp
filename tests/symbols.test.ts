import { describe, it, expect } from "vitest";
import { SymbolKind } from "vscode-languageserver/node";
import { parseDocument } from "../src/parser/index";
import { getDocumentSymbols } from "../src/symbols";

/** Parse and return document symbols. */
function symbols(sql: string) {
  const { ast } = parseDocument(sql);
  return getDocumentSymbols(ast);
}

/** Shorthand: parse, get symbols, return flat array of {name, kind} */
function symbolNames(sql: string) {
  return symbols(sql).map((s) => ({ name: s.name, kind: s.kind }));
}

describe("Document Symbols", () => {
  describe("procedures and functions", () => {
    it("should return a symbol for CREATE PROCEDURE", () => {
      const syms = symbols(`
        CREATE PROCEDURE greet (p_name VARCHAR2) AS
        BEGIN
          NULL;
        END;
      `);
      expect(syms).toHaveLength(1);
      expect(syms[0].name).toBe("greet");
      expect(syms[0].kind).toBe(SymbolKind.Function);
    });

    it("should return a symbol for CREATE OR REPLACE PROCEDURE", () => {
      const syms = symbols(`
        CREATE OR REPLACE PROCEDURE do_stuff AS
        BEGIN
          NULL;
        END;
      `);
      expect(syms).toHaveLength(1);
      expect(syms[0].name).toBe("do_stuff");
      expect(syms[0].kind).toBe(SymbolKind.Function);
    });

    it("should return a symbol for CREATE FUNCTION", () => {
      const syms = symbols(`
        CREATE FUNCTION add_one (p_val NUMBER) RETURN NUMBER AS
        BEGIN
          RETURN p_val + 1;
        END;
      `);
      expect(syms).toHaveLength(1);
      expect(syms[0].name).toBe("add_one");
      expect(syms[0].kind).toBe(SymbolKind.Function);
    });
  });

  describe("packages", () => {
    it("should return a symbol for CREATE PACKAGE", () => {
      const syms = symbols(`
        CREATE PACKAGE my_pkg AS
          PROCEDURE do_something;
          FUNCTION get_value RETURN NUMBER;
        END my_pkg;
      `);
      expect(syms).toHaveLength(1);
      expect(syms[0].name).toBe("my_pkg");
      expect(syms[0].kind).toBe(SymbolKind.Package);
    });

    it("should include child symbols in a package spec", () => {
      const syms = symbols(`
        CREATE PACKAGE my_pkg AS
          PROCEDURE do_something;
          FUNCTION get_value RETURN NUMBER;
        END my_pkg;
      `);
      expect(syms[0].children).toBeDefined();
      expect(syms[0].children!.length).toBe(2);
      expect(syms[0].children![0].name).toBe("do_something");
      expect(syms[0].children![1].name).toBe("get_value");
    });

    it("should return a symbol for CREATE PACKAGE BODY", () => {
      const syms = symbols(`
        CREATE PACKAGE BODY my_pkg AS
          PROCEDURE do_something AS
          BEGIN
            NULL;
          END;
        END my_pkg;
      `);
      expect(syms).toHaveLength(1);
      expect(syms[0].name).toBe("my_pkg");
      expect(syms[0].kind).toBe(SymbolKind.Package);
      expect(syms[0].children).toBeDefined();
      expect(syms[0].children![0].name).toBe("do_something");
    });
  });

  describe("DDL objects", () => {
    it("should return a symbol for CREATE TABLE", () => {
      const syms = symbols("CREATE TABLE employees (id NUMBER, name VARCHAR2(100));");
      expect(syms).toHaveLength(1);
      expect(syms[0].name).toBe("employees");
      expect(syms[0].kind).toBe(SymbolKind.Struct);
    });

    it("should return a symbol for schema-qualified CREATE TABLE", () => {
      const syms = symbols("CREATE TABLE hr.employees (id NUMBER);");
      expect(syms).toHaveLength(1);
      expect(syms[0].name).toBe("hr.employees");
      expect(syms[0].kind).toBe(SymbolKind.Struct);
    });

    it("should return a symbol for CREATE VIEW", () => {
      const syms = symbols("CREATE VIEW emp_view AS SELECT id, name FROM employees;");
      expect(syms).toHaveLength(1);
      expect(syms[0].name).toBe("emp_view");
      expect(syms[0].kind).toBe(SymbolKind.Struct);
    });

    it("should return a symbol for CREATE INDEX", () => {
      const syms = symbols("CREATE INDEX idx_emp_name ON employees (name);");
      expect(syms).toHaveLength(1);
      expect(syms[0].name).toBe("idx_emp_name");
      expect(syms[0].kind).toBe(SymbolKind.Key);
    });

    it("should return a symbol for CREATE SEQUENCE", () => {
      const syms = symbols("CREATE SEQUENCE emp_seq START WITH 1 INCREMENT BY 1;");
      expect(syms).toHaveLength(1);
      expect(syms[0].name).toBe("emp_seq");
      expect(syms[0].kind).toBe(SymbolKind.Constant);
    });
  });

  describe("triggers", () => {
    it("should return a symbol for CREATE TRIGGER", () => {
      const syms = symbols(`
        CREATE TRIGGER trg_emp
        BEFORE INSERT ON employees
        FOR EACH ROW
        BEGIN
          NULL;
        END;
      `);
      expect(syms).toHaveLength(1);
      expect(syms[0].name).toBe("trg_emp");
      expect(syms[0].kind).toBe(SymbolKind.Event);
    });
  });

  describe("PL/SQL declarations", () => {
    it("should return symbols for variable declarations in a procedure", () => {
      const syms = symbols(`
        CREATE PROCEDURE test_proc AS
          v_count NUMBER;
          v_name VARCHAR2(100);
        BEGIN
          NULL;
        END;
      `);
      expect(syms).toHaveLength(1);
      const children = syms[0].children ?? [];
      const varNames = children.map((c) => c.name);
      expect(varNames).toContain("v_count");
      expect(varNames).toContain("v_name");
    });

    it("should return symbols for cursor declarations", () => {
      const syms = symbols(`
        CREATE PACKAGE my_pkg AS
          CURSOR c_emp RETURN employees%ROWTYPE;
        END my_pkg;
      `);
      expect(syms).toHaveLength(1);
      const children = syms[0].children ?? [];
      const cursor = children.find((c) => c.name === "c_emp");
      expect(cursor).toBeDefined();
      expect(cursor!.kind).toBe(SymbolKind.Interface);
    });

    it("should return symbols for exception declarations", () => {
      const syms = symbols(`
        CREATE PROCEDURE test_proc AS
          e_custom EXCEPTION;
        BEGIN
          NULL;
        END;
      `);
      const children = syms[0].children ?? [];
      const exc = children.find((c) => c.name === "e_custom");
      expect(exc).toBeDefined();
      expect(exc!.kind).toBe(SymbolKind.Event);
    });
  });

  describe("anonymous blocks", () => {
    it("should return a symbol for anonymous block with declarations", () => {
      const syms = symbols(`
        DECLARE
          v_x NUMBER;
        BEGIN
          NULL;
        END;
      `);
      expect(syms).toHaveLength(1);
      expect(syms[0].name).toBe("<anonymous block>");
      expect(syms[0].kind).toBe(SymbolKind.Namespace);
      expect(syms[0].children).toBeDefined();
      expect(syms[0].children![0].name).toBe("v_x");
    });

    it("should not return a symbol for anonymous block without children", () => {
      const syms = symbols(`
        BEGIN
          NULL;
        END;
      `);
      // Anonymous block with no declarations produces no symbol
      expect(syms).toHaveLength(0);
    });
  });

  describe("multiple statements", () => {
    it("should return symbols for multiple top-level objects", () => {
      const syms = symbolNames(`
        CREATE TABLE t1 (id NUMBER);
        CREATE VIEW v1 AS SELECT id FROM t1;
        CREATE SEQUENCE s1 START WITH 1;
      `);
      expect(syms).toEqual([
        { name: "t1", kind: SymbolKind.Struct },
        { name: "v1", kind: SymbolKind.Struct },
        { name: "s1", kind: SymbolKind.Constant },
      ]);
    });
  });

  describe("symbol ranges", () => {
    it("should have valid range and selectionRange", () => {
      const syms = symbols("CREATE TABLE employees (id NUMBER);");
      expect(syms).toHaveLength(1);
      const sym = syms[0];
      expect(sym.range).toBeDefined();
      expect(sym.range.start).toHaveProperty("line");
      expect(sym.range.start).toHaveProperty("character");
      expect(sym.selectionRange).toBeDefined();
      expect(sym.selectionRange.start).toHaveProperty("line");
      expect(sym.selectionRange.start).toHaveProperty("character");
    });

    it("selectionRange should be within range", () => {
      const syms = symbols("CREATE TABLE employees (id NUMBER);");
      const sym = syms[0];
      // selectionRange start should be >= range start
      expect(sym.selectionRange.start.line).toBeGreaterThanOrEqual(sym.range.start.line);
      // selectionRange end should be <= range end
      expect(sym.selectionRange.end.line).toBeLessThanOrEqual(sym.range.end.line);
    });
  });

  describe("DML statements produce no symbols", () => {
    it("should return no symbols for SELECT", () => {
      expect(symbols("SELECT 1 FROM dual;")).toHaveLength(0);
    });

    it("should return no symbols for INSERT", () => {
      expect(symbols("INSERT INTO t (a) VALUES (1);")).toHaveLength(0);
    });

    it("should return no symbols for UPDATE", () => {
      expect(symbols("UPDATE t SET a = 1;")).toHaveLength(0);
    });

    it("should return no symbols for DELETE", () => {
      expect(symbols("DELETE FROM t WHERE id = 1;")).toHaveLength(0);
    });
  });
});
