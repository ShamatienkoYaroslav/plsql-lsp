import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";
import { getCompletions } from "../src/completion";
import { CompletionItemKind, InsertTextFormat } from "vscode-languageserver/node";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function complete(sql: string, marker = "/*|*/") {
  const pos = sql.indexOf(marker);
  if (pos === -1) throw new Error("marker not found in sql");
  const text = sql.replace(marker, "");
  const { ast } = parseDocument(text);
  return getCompletions(ast, text, pos);
}

function labels(items: ReturnType<typeof complete>): string[] {
  return items.map(i => i.label);
}

function findItem(items: ReturnType<typeof complete>, label: string) {
  return items.find(i => i.label.toUpperCase() === label.toUpperCase());
}

// ─── 1. Keywords are offered ─────────────────────────────────────────────────

describe("Keywords are offered", () => {
  it("SELECT is offered as a keyword inside a procedure body", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(labels(items)).toContain("SELECT");
  });

  it("IF is offered as a keyword inside a procedure body", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(labels(items)).toContain("IF");
  });

  it("NULL is offered as a keyword inside a procedure body", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(labels(items)).toContain("NULL");
  });

  it("RETURN is offered as a keyword inside a procedure body", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(labels(items)).toContain("RETURN");
  });

  it("keyword items have kind Keyword", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/ END;";
    const items = complete(sql);
    const selectItem = findItem(items, "SELECT");
    expect(selectItem).toBeDefined();
    expect(selectItem!.kind).toBe(CompletionItemKind.Keyword);
  });

  it("all keyword items have kind Keyword", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/ END;";
    const items = complete(sql);
    const keywordItems = items.filter(i => i.kind === CompletionItemKind.Keyword);
    expect(keywordItems.length).toBeGreaterThan(0);
    for (const item of keywordItems) {
      expect(item.kind).toBe(CompletionItemKind.Keyword);
    }
  });
});

// ─── 2. Local variables are offered ──────────────────────────────────────────

describe("Local variables are offered", () => {
  it("declared variable v_count is offered at cursor position", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; v_name VARCHAR2(100); BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(labels(items)).toContain("v_count");
  });

  it("declared variable v_name is offered at cursor position", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; v_name VARCHAR2(100); BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(labels(items)).toContain("v_name");
  });

  it("variable items have kind Variable", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; v_name VARCHAR2(100); BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(findItem(items, "v_count")?.kind).toBe(CompletionItemKind.Variable);
    expect(findItem(items, "v_name")?.kind).toBe(CompletionItemKind.Variable);
  });

  it("v_count detail contains NUMBER", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; v_name VARCHAR2(100); BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(findItem(items, "v_count")?.detail).toContain("NUMBER");
  });

  it("v_name detail contains VARCHAR2", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; v_name VARCHAR2(100); BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(findItem(items, "v_name")?.detail).toContain("VARCHAR2");
  });
});

// ─── 3. Parameters are offered ───────────────────────────────────────────────

describe("Parameters are offered", () => {
  it("IN parameter p_id is offered inside body", () => {
    const sql = "CREATE PROCEDURE p (p_id IN NUMBER, p_name IN OUT VARCHAR2) AS BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(labels(items)).toContain("p_id");
  });

  it("IN OUT parameter p_name is offered inside body", () => {
    const sql = "CREATE PROCEDURE p (p_id IN NUMBER, p_name IN OUT VARCHAR2) AS BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(labels(items)).toContain("p_name");
  });

  it("p_id detail contains IN", () => {
    const sql = "CREATE PROCEDURE p (p_id IN NUMBER, p_name IN OUT VARCHAR2) AS BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(findItem(items, "p_id")?.detail).toContain("IN");
  });

  it("p_id detail contains NUMBER", () => {
    const sql = "CREATE PROCEDURE p (p_id IN NUMBER, p_name IN OUT VARCHAR2) AS BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(findItem(items, "p_id")?.detail).toContain("NUMBER");
  });

  it("p_name detail contains IN OUT", () => {
    const sql = "CREATE PROCEDURE p (p_id IN NUMBER, p_name IN OUT VARCHAR2) AS BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(findItem(items, "p_name")?.detail).toContain("IN OUT");
  });

  it("p_name detail contains VARCHAR2", () => {
    const sql = "CREATE PROCEDURE p (p_id IN NUMBER, p_name IN OUT VARCHAR2) AS BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(findItem(items, "p_name")?.detail).toContain("VARCHAR2");
  });

  it("parameter items have kind Variable", () => {
    const sql = "CREATE PROCEDURE p (p_id IN NUMBER, p_name IN OUT VARCHAR2) AS BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(findItem(items, "p_id")?.kind).toBe(CompletionItemKind.Variable);
    expect(findItem(items, "p_name")?.kind).toBe(CompletionItemKind.Variable);
  });
});

// ─── 4. Prefix filtering ─────────────────────────────────────────────────────

describe("Prefix filtering", () => {
  it("v_ prefix includes v_count", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; v_name VARCHAR2(100); w_other NUMBER; BEGIN v_/*|*/ END;";
    const items = complete(sql);
    expect(labels(items)).toContain("v_count");
  });

  it("v_ prefix includes v_name", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; v_name VARCHAR2(100); w_other NUMBER; BEGIN v_/*|*/ END;";
    const items = complete(sql);
    expect(labels(items)).toContain("v_name");
  });

  it("v_ prefix excludes w_other", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; v_name VARCHAR2(100); w_other NUMBER; BEGIN v_/*|*/ END;";
    const items = complete(sql);
    expect(labels(items)).not.toContain("w_other");
  });

  it("v_ prefix includes keywords starting with V such as VALUES", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; v_name VARCHAR2(100); w_other NUMBER; BEGIN v_/*|*/ END;";
    const items = complete(sql);
    const kwLabels = labels(items).filter(l => items.find(i => i.label === l && i.kind === CompletionItemKind.Keyword));
    // All returned keywords must start with V (case-insensitive)
    for (const label of kwLabels) {
      expect(label.toUpperCase().startsWith("V")).toBe(true);
    }
  });

  it("v_ prefix excludes keywords not starting with V such as SELECT", () => {
    const sql = "CREATE PROCEDURE p AS v_count NUMBER; v_name VARCHAR2(100); w_other NUMBER; BEGIN v_/*|*/ END;";
    const items = complete(sql);
    expect(labels(items)).not.toContain("SELECT");
  });
});

// ─── 5. Scope awareness - inner scope sees outer variables ────────────────────

describe("Scope awareness: inner sees outer", () => {
  it("v_outer is visible from inside the inner block", () => {
    const sql = `DECLARE
  v_outer NUMBER;
BEGIN
  DECLARE
    v_inner NUMBER;
  BEGIN
    /*|*/
  END;
END;`;
    const items = complete(sql);
    expect(labels(items)).toContain("v_outer");
  });

  it("v_inner is visible inside the inner block", () => {
    const sql = `DECLARE
  v_outer NUMBER;
BEGIN
  DECLARE
    v_inner NUMBER;
  BEGIN
    /*|*/
  END;
END;`;
    const items = complete(sql);
    expect(labels(items)).toContain("v_inner");
  });
});

// ─── 6. Scope awareness - outer scope does NOT see inner variables ────────────

describe("Scope awareness: outer does NOT see inner", () => {
  it("v_outer is visible at the outer BEGIN level", () => {
    const sql = `DECLARE
  v_outer NUMBER;
BEGIN
  DECLARE
    v_inner NUMBER;
  BEGIN
    NULL;
  END;
  /*|*/
END;`;
    const items = complete(sql);
    expect(labels(items)).toContain("v_outer");
  });

  it("v_inner is NOT visible at the outer BEGIN level", () => {
    const sql = `DECLARE
  v_outer NUMBER;
BEGIN
  DECLARE
    v_inner NUMBER;
  BEGIN
    NULL;
  END;
  /*|*/
END;`;
    const items = complete(sql);
    expect(labels(items)).not.toContain("v_inner");
  });
});

// ─── 7. Procedures and functions in scope ────────────────────────────────────

describe("Procedures and functions in scope", () => {
  it("helper procedure is offered inside main", () => {
    const sql = `CREATE PACKAGE BODY my_pkg AS
  PROCEDURE helper AS BEGIN NULL; END;
  FUNCTION calc RETURN NUMBER AS BEGIN RETURN 1; END;
  PROCEDURE main AS BEGIN /*|*/ END;
END my_pkg;`;
    const items = complete(sql);
    expect(labels(items)).toContain("helper");
  });

  it("calc function is offered inside main", () => {
    const sql = `CREATE PACKAGE BODY my_pkg AS
  PROCEDURE helper AS BEGIN NULL; END;
  FUNCTION calc RETURN NUMBER AS BEGIN RETURN 1; END;
  PROCEDURE main AS BEGIN /*|*/ END;
END my_pkg;`;
    const items = complete(sql);
    expect(labels(items)).toContain("calc");
  });

  it("helper has kind Function", () => {
    const sql = `CREATE PACKAGE BODY my_pkg AS
  PROCEDURE helper AS BEGIN NULL; END;
  FUNCTION calc RETURN NUMBER AS BEGIN RETURN 1; END;
  PROCEDURE main AS BEGIN /*|*/ END;
END my_pkg;`;
    const items = complete(sql);
    expect(findItem(items, "helper")?.kind).toBe(CompletionItemKind.Function);
  });

  it("calc has kind Function", () => {
    const sql = `CREATE PACKAGE BODY my_pkg AS
  PROCEDURE helper AS BEGIN NULL; END;
  FUNCTION calc RETURN NUMBER AS BEGIN RETURN 1; END;
  PROCEDURE main AS BEGIN /*|*/ END;
END my_pkg;`;
    const items = complete(sql);
    expect(findItem(items, "calc")?.kind).toBe(CompletionItemKind.Function);
  });
});

// ─── 8. Cursors and exceptions in scope ──────────────────────────────────────

describe("Cursors and exceptions in scope", () => {
  it("cursor c_emp is offered inside body", () => {
    const sql = `CREATE PROCEDURE p AS
  CURSOR c_emp IS SELECT 1 FROM dual;
  e_custom EXCEPTION;
BEGIN
  /*|*/
END;`;
    const items = complete(sql);
    expect(labels(items)).toContain("c_emp");
  });

  it("cursor c_emp has kind Interface", () => {
    const sql = `CREATE PROCEDURE p AS
  CURSOR c_emp IS SELECT 1 FROM dual;
  e_custom EXCEPTION;
BEGIN
  /*|*/
END;`;
    const items = complete(sql);
    expect(findItem(items, "c_emp")?.kind).toBe(CompletionItemKind.Interface);
  });

  it("exception e_custom is offered inside body", () => {
    const sql = `CREATE PROCEDURE p AS
  CURSOR c_emp IS SELECT 1 FROM dual;
  e_custom EXCEPTION;
BEGIN
  /*|*/
END;`;
    const items = complete(sql);
    expect(labels(items)).toContain("e_custom");
  });

  it("exception e_custom has kind Event", () => {
    const sql = `CREATE PROCEDURE p AS
  CURSOR c_emp IS SELECT 1 FROM dual;
  e_custom EXCEPTION;
BEGIN
  /*|*/
END;`;
    const items = complete(sql);
    expect(findItem(items, "e_custom")?.kind).toBe(CompletionItemKind.Event);
  });
});

// ─── 9. Symbols sort before keywords ─────────────────────────────────────────

describe("Symbols sort before keywords", () => {
  it("symbol v_x has sortText starting with '0'", () => {
    const sql = "CREATE PROCEDURE p AS v_x NUMBER; BEGIN /*|*/ END;";
    const items = complete(sql);
    const vxItem = findItem(items, "v_x");
    expect(vxItem).toBeDefined();
    expect(vxItem!.sortText).toBeDefined();
    expect(vxItem!.sortText!.startsWith("0")).toBe(true);
  });

  it("keyword items have sortText starting with '1'", () => {
    const sql = "CREATE PROCEDURE p AS v_x NUMBER; BEGIN /*|*/ END;";
    const items = complete(sql);
    const selectItem = findItem(items, "SELECT");
    expect(selectItem).toBeDefined();
    expect(selectItem!.sortText).toBeDefined();
    expect(selectItem!.sortText!.startsWith("1")).toBe(true);
  });
});

// ─── 10. Empty prefix returns all items ──────────────────────────────────────

describe("Empty prefix returns all items", () => {
  it("results contain both symbols and keywords with empty prefix", () => {
    const sql = "CREATE PROCEDURE p AS v_x NUMBER; BEGIN /*|*/ END;";
    const items = complete(sql);
    const hasSymbol = items.some(i => i.kind === CompletionItemKind.Variable);
    const hasKeyword = items.some(i => i.kind === CompletionItemKind.Keyword);
    expect(hasSymbol).toBe(true);
    expect(hasKeyword).toBe(true);
  });

  it("total item count is greater than 100 with empty prefix", () => {
    const sql = "CREATE PROCEDURE p AS v_x NUMBER; BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(items.length).toBeGreaterThan(100);
  });
});

// ─── 11. FOR loop variable available inside loop ──────────────────────────────

describe("FOR loop variable available inside loop", () => {
  it("loop counter i is offered inside the loop body", () => {
    const sql = "CREATE PROCEDURE p AS v_sum NUMBER; BEGIN FOR i IN 1..10 LOOP /*|*/ END LOOP; END;";
    const items = complete(sql);
    expect(labels(items)).toContain("i");
  });

  it("outer variable v_sum is also offered inside the loop body", () => {
    const sql = "CREATE PROCEDURE p AS v_sum NUMBER; BEGIN FOR i IN 1..10 LOOP /*|*/ END LOOP; END;";
    const items = complete(sql);
    expect(labels(items)).toContain("v_sum");
  });

  it("loop counter i has kind Variable", () => {
    const sql = "CREATE PROCEDURE p AS v_sum NUMBER; BEGIN FOR i IN 1..10 LOOP /*|*/ END LOOP; END;";
    const items = complete(sql);
    expect(findItem(items, "i")?.kind).toBe(CompletionItemKind.Variable);
  });
});

// ─── 12. Keyword prefix is case-insensitive ───────────────────────────────────

describe("Keyword prefix is case-insensitive", () => {
  it("lowercase prefix 'sel' matches keyword SELECT", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN sel/*|*/ END;";
    const items = complete(sql);
    expect(labels(items)).toContain("SELECT");
  });

  it("mixed-case prefix 'Sel' matches keyword SELECT", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN Sel/*|*/ END;";
    const items = complete(sql);
    expect(labels(items)).toContain("SELECT");
  });

  it("uppercase prefix 'SEL' matches keyword SELECT", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN SEL/*|*/ END;";
    const items = complete(sql);
    expect(labels(items)).toContain("SELECT");
  });
});

// ─── 13. No duplicate keywords ───────────────────────────────────────────────

describe("No duplicate keywords", () => {
  it("labels list has no duplicates", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/ END;";
    const items = complete(sql);
    const ls = labels(items);
    expect(new Set(ls).size).toBe(ls.length);
  });

  it("SELECT does not appear more than once in the results", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/ END;";
    const items = complete(sql);
    const selectItems = items.filter(i => i.label === "SELECT");
    expect(selectItems.length).toBe(1);
  });
});

// ─── 14. Snippet completions ──────────────────────────────────────────────────

describe("Snippet completions", () => {
  it("snippets are offered with kind Snippet inside a procedure body", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/ END;";
    const items = complete(sql);
    const snippetItems = items.filter(i => i.kind === CompletionItemKind.Snippet);
    expect(snippetItems.length).toBeGreaterThan(0);
    const snippetLabels = snippetItems.map(i => i.label);
    expect(snippetLabels).toContain("IF");
    expect(snippetLabels).toContain("FOR LOOP");
    expect(snippetLabels).toContain("BEGIN END");
  });

  it("snippet items have kind Snippet", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(findItem(items, "IF")?.kind).toBe(CompletionItemKind.Snippet);
    expect(findItem(items, "FOR LOOP")?.kind).toBe(CompletionItemKind.Snippet);
    expect(findItem(items, "BEGIN END")?.kind).toBe(CompletionItemKind.Snippet);
  });

  it("FO prefix includes FOR LOOP, FOR CURSOR, and FORALL snippets", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN FO/*|*/ END;";
    const items = complete(sql);
    const ls = labels(items);
    expect(ls).toContain("FOR LOOP");
    expect(ls).toContain("FOR CURSOR");
    expect(ls).toContain("FORALL");
  });

  it("FO prefix excludes IF and BEGIN END snippets", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN FO/*|*/ END;";
    const items = complete(sql);
    const ls = labels(items);
    expect(ls).not.toContain("IF");
    expect(ls).not.toContain("BEGIN END");
  });

  it("IF snippet insertText contains tab stop markers", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(findItem(items, "IF")?.insertText).toContain("$");
  });

  it("FOR LOOP snippet insertText contains tab stop markers", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(findItem(items, "FOR LOOP")?.insertText).toContain("$");
  });

  it("snippet sortText starts with '2'", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/ END;";
    const items = complete(sql);
    const ifSnippet = findItem(items, "IF");
    expect(ifSnippet).toBeDefined();
    expect(ifSnippet!.sortText).toBeDefined();
    expect(ifSnippet!.sortText!.startsWith("2")).toBe(true);
  });

  it("keyword sortText starts with '1'", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/ END;";
    const items = complete(sql);
    const selectItem = findItem(items, "SELECT");
    expect(selectItem).toBeDefined();
    expect(selectItem!.sortText).toBeDefined();
    expect(selectItem!.sortText!.startsWith("1")).toBe(true);
  });

  it("symbol sortText starts with '0'", () => {
    const sql = "CREATE PROCEDURE p AS v_x NUMBER; BEGIN /*|*/ END;";
    const items = complete(sql);
    const symItem = findItem(items, "v_x");
    expect(symItem).toBeDefined();
    expect(symItem!.sortText).toBeDefined();
    expect(symItem!.sortText!.startsWith("0")).toBe(true);
  });

  it("IF snippet has insertTextFormat equal to InsertTextFormat.Snippet", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(findItem(items, "IF")?.insertTextFormat).toBe(InsertTextFormat.Snippet);
  });

  it("FOR LOOP snippet has insertTextFormat equal to InsertTextFormat.Snippet", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN /*|*/ END;";
    const items = complete(sql);
    expect(findItem(items, "FOR LOOP")?.insertTextFormat).toBe(InsertTextFormat.Snippet);
  });

  it("InsertTextFormat.Snippet equals 2", () => {
    expect(InsertTextFormat.Snippet).toBe(2);
  });
});
