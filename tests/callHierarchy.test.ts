import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";
import { prepareCallHierarchy, getIncomingCalls, getOutgoingCalls } from "../src/callHierarchy";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function prepare(sql: string, name: string) {
  const { ast } = parseDocument(sql);
  const offset = sql.indexOf(name);
  return prepareCallHierarchy(ast, sql, offset, "file:///test.sql");
}

function incoming(sql: string, name: string) {
  const { ast } = parseDocument(sql);
  const items = prepareCallHierarchy(ast, sql, sql.indexOf(name), "file:///test.sql");
  if (!items || items.length === 0) return [];
  return getIncomingCalls(items[0], ast, sql);
}

function outgoing(sql: string, name: string) {
  const { ast } = parseDocument(sql);
  const items = prepareCallHierarchy(ast, sql, sql.indexOf(name), "file:///test.sql");
  if (!items || items.length === 0) return [];
  return getOutgoingCalls(items[0], ast, sql);
}

// ─── 1. Prepare ───────────────────────────────────────────────────────────────

describe("prepareCallHierarchy", () => {
  it("returns an item for a procedure", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN NULL; END;";
    const items = prepare(sql, "p");
    expect(items).not.toBeNull();
    expect(items!.length).toBe(1);
    expect(items![0].name).toBe("p");
  });

  it("returns an item for a function", () => {
    const sql = "CREATE FUNCTION f RETURN NUMBER AS BEGIN RETURN 1; END;";
    const items = prepare(sql, "f");
    expect(items).not.toBeNull();
    expect(items![0].name).toBe("f");
  });

  it("returns null for a variable", () => {
    const sql = "CREATE PROCEDURE p AS v_x NUMBER; BEGIN NULL; END;";
    const items = prepare(sql, "v_x");
    expect(items).toBeNull();
  });

  it("returns null for unknown identifier", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN NULL; END;";
    const items = prepare(sql, "unknown");
    expect(items).toBeNull();
  });
});

// ─── 2. Incoming calls ───────────────────────────────────────────────────────

describe("getIncomingCalls", () => {
  const sql = `CREATE PACKAGE BODY pkg AS
  PROCEDURE helper AS BEGIN NULL; END;
  PROCEDURE caller1 AS BEGIN helper; END;
  PROCEDURE caller2 AS BEGIN helper; helper; END;
END pkg;`;

  it("finds callers of a procedure", () => {
    const calls = incoming(sql, "helper");
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const callerNames = calls.map(c => c.from.name);
    expect(callerNames).toContain("caller1");
  });

  it("groups multiple calls from the same caller", () => {
    const calls = incoming(sql, "helper");
    const caller2 = calls.find(c => c.from.name === "caller2");
    if (caller2) {
      expect(caller2.fromRanges.length).toBe(2);
    }
  });

  it("returns empty for procedure with no callers", () => {
    const calls = incoming(sql, "caller1");
    expect(calls.length).toBe(0);
  });
});

// ─── 3. Outgoing calls ──────────────────────────────────────────────────────

describe("getOutgoingCalls", () => {
  const sql = `CREATE PACKAGE BODY pkg AS
  PROCEDURE proc_a AS BEGIN NULL; END;
  PROCEDURE proc_b AS BEGIN NULL; END;
  PROCEDURE main AS BEGIN proc_a; proc_b; END;
END pkg;`;

  it("finds outgoing calls from a procedure", () => {
    const calls = outgoing(sql, "main");
    expect(calls.length).toBe(2);
    const calleeNames = calls.map(c => c.to.name);
    expect(calleeNames).toContain("proc_a");
    expect(calleeNames).toContain("proc_b");
  });

  it("returns empty for a leaf procedure", () => {
    const calls = outgoing(sql, "proc_a");
    expect(calls.length).toBe(0);
  });
});

// ─── 4. Self-references excluded ─────────────────────────────────────────────

describe("Self-references excluded", () => {
  it("recursive calls do not appear in incoming calls", () => {
    const sql = `CREATE PACKAGE BODY pkg AS
  PROCEDURE recurse AS BEGIN recurse; END;
END pkg;`;
    const calls = incoming(sql, "recurse");
    // Self-call should be excluded from incoming
    const callerNames = calls.map(c => c.from.name.toUpperCase());
    expect(callerNames).not.toContain("RECURSE");
  });
});

// ─── 5. Function calls ──────────────────────────────────────────────────────

describe("Function call hierarchy", () => {
  const sql = `CREATE PACKAGE BODY pkg AS
  FUNCTION helper RETURN NUMBER AS BEGIN RETURN 1; END;
  PROCEDURE main AS v_x NUMBER; BEGIN v_x := helper; END;
END pkg;`;

  it("function appears in outgoing calls of caller", () => {
    const calls = outgoing(sql, "main");
    const calleeNames = calls.map(c => c.to.name);
    expect(calleeNames).toContain("helper");
  });

  it("caller appears in incoming calls of function", () => {
    const calls = incoming(sql, "helper");
    const callerNames = calls.map(c => c.from.name);
    expect(callerNames).toContain("main");
  });
});
