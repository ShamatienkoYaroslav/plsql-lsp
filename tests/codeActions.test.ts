import { describe, it, expect } from "vitest";
import {
  Diagnostic,
  DiagnosticSeverity,
  CodeActionKind,
  Position,
} from "vscode-languageserver/node";
import { getCodeActions } from "../src/codeActions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function columnDiag(
  column: string,
  table: string,
  line = 0,
  startChar = 0,
  endChar = 5,
): Diagnostic {
  return {
    severity: DiagnosticSeverity.Warning,
    range: {
      start: Position.create(line, startChar),
      end: Position.create(line, endChar),
    },
    message: `Column '${column}' does not exist in table '${table}'`,
    source: "plsql-lsp(catalog)",
  };
}

function tableDiag(
  table: string,
  line = 0,
  startChar = 0,
  endChar = 5,
): Diagnostic {
  return {
    severity: DiagnosticSeverity.Warning,
    range: {
      start: Position.create(line, startChar),
      end: Position.create(line, endChar),
    },
    message: `Table '${table}' does not exist`,
    source: "plsql-lsp(catalog)",
  };
}

const URI = "file:///test.sql";
const TEXT = "SELECT * FROM employees;\n";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("getCodeActions", () => {
  it("returns empty array when no diagnostics are provided", () => {
    const actions = getCodeActions([], TEXT, URI);
    expect(actions).toEqual([]);
  });

  it("ignores diagnostics from other sources", () => {
    const diag: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: Position.create(0, 0),
        end: Position.create(0, 5),
      },
      message: "Some parser error",
      source: "plsql-lsp(parser)",
    };
    const actions = getCodeActions([diag], TEXT, URI);
    expect(actions).toEqual([]);
  });

  describe("missing column", () => {
    it("creates a quick fix to add ALTER TABLE statement", () => {
      const diag = columnDiag("BONUS", "EMPLOYEES");
      const actions = getCodeActions([diag], TEXT, URI);

      expect(actions).toHaveLength(1);
      const action = actions[0];
      expect(action.title).toBe("Add column BONUS to EMPLOYEES");
      expect(action.kind).toBe(CodeActionKind.QuickFix);
      expect(action.diagnostics).toEqual([diag]);
      expect(action.edit).toBeDefined();

      const edits = action.edit!.changes![URI];
      expect(edits).toHaveLength(1);
      expect(edits[0].newText).toContain("ALTER TABLE EMPLOYEES ADD (BONUS VARCHAR2(100));");
    });

    it("inserts the ALTER TABLE at the end of the document", () => {
      const multiLineText = "SELECT e.BONUS\nFROM employees e;\n";
      const diag = columnDiag("BONUS", "EMPLOYEES", 0, 9, 14);
      const actions = getCodeActions([diag], multiLineText, URI);

      expect(actions).toHaveLength(1);
      const edits = actions[0].edit!.changes![URI];
      // The text has 3 lines (2 content + trailing newline produces empty 3rd line)
      expect(edits[0].range.start.line).toBe(3);
      expect(edits[0].range.start.character).toBe(0);
    });
  });

  describe("missing table", () => {
    it("creates a quick fix to add CREATE TABLE template", () => {
      const diag = tableDiag("BONUSES");
      const actions = getCodeActions([diag], TEXT, URI);

      expect(actions).toHaveLength(1);
      const action = actions[0];
      expect(action.title).toBe("Create table BONUSES");
      expect(action.kind).toBe(CodeActionKind.QuickFix);
      expect(action.diagnostics).toEqual([diag]);

      const edits = action.edit!.changes![URI];
      expect(edits).toHaveLength(1);
      expect(edits[0].newText).toContain("CREATE TABLE BONUSES");
      expect(edits[0].newText).toContain("id NUMBER PRIMARY KEY");
    });
  });

  describe("multiple diagnostics", () => {
    it("returns one action per diagnostic", () => {
      const diags = [
        tableDiag("BONUSES"),
        columnDiag("SALARY_BONUS", "EMPLOYEES"),
      ];
      const actions = getCodeActions(diags, TEXT, URI);
      expect(actions).toHaveLength(2);
      expect(actions[0].title).toBe("Create table BONUSES");
      expect(actions[1].title).toBe("Add column SALARY_BONUS to EMPLOYEES");
    });

    it("handles a mix of catalog and non-catalog diagnostics", () => {
      const diags: Diagnostic[] = [
        tableDiag("BONUSES"),
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: Position.create(0, 0),
            end: Position.create(0, 5),
          },
          message: "Syntax error",
          source: "plsql-lsp(parser)",
        },
        columnDiag("FOO", "BAR"),
      ];
      const actions = getCodeActions(diags, TEXT, URI);
      expect(actions).toHaveLength(2);
    });
  });

  describe("edge cases", () => {
    it("handles empty document text", () => {
      const diag = tableDiag("MISSING");
      const actions = getCodeActions([diag], "", URI);
      expect(actions).toHaveLength(1);
      // Should insert at line 1 (single empty line)
      const edits = actions[0].edit!.changes![URI];
      expect(edits[0].range.start.line).toBe(1);
    });

    it("handles column names with special characters in the message", () => {
      const diag: Diagnostic = {
        severity: DiagnosticSeverity.Warning,
        range: {
          start: Position.create(0, 0),
          end: Position.create(0, 10),
        },
        message: "Column 'MY_COL$1' does not exist in table 'MY_TABLE#2'",
        source: "plsql-lsp(catalog)",
      };
      const actions = getCodeActions([diag], TEXT, URI);
      expect(actions).toHaveLength(1);
      expect(actions[0].title).toBe("Add column MY_COL$1 to MY_TABLE#2");
    });

    it("uses the provided URI as the key in workspace edit changes", () => {
      const customUri = "file:///workspace/schema.sql";
      const diag = tableDiag("ORDERS");
      const actions = getCodeActions([diag], TEXT, customUri);
      expect(actions).toHaveLength(1);
      expect(actions[0].edit!.changes![customUri]).toBeDefined();
      expect(actions[0].edit!.changes![URI]).toBeUndefined();
    });
  });
});
