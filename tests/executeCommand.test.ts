import { describe, it, expect } from "vitest";
import { executeCommand, COMMANDS } from "../src/executeCommand";

// ─── 1. Command registry ─────────────────────────────────────────────────────

describe("Command registry", () => {
  it("exports expected commands", () => {
    expect(COMMANDS).toContain("oradev.runStatement");
    expect(COMMANDS).toContain("oradev.explainPlan");
    expect(COMMANDS).toContain("oradev.compilePackage");
    expect(COMMANDS).toContain("oradev.showReferences");
  });
});

// ─── 2. Without catalog connection ──────────────────────────────────────────

describe("Commands without catalog connection", () => {
  it("runStatement fails without connection", async () => {
    const result = await executeCommand("oradev.runStatement", ["file:///test.sql", "my_proc"], null);
    expect(result.success).toBe(false);
    expect(result.message).toContain("No active database connection");
  });

  it("explainPlan fails without connection", async () => {
    const result = await executeCommand("oradev.explainPlan", ["SELECT 1 FROM dual"], null);
    expect(result.success).toBe(false);
    expect(result.message).toContain("No active database connection");
  });

  it("compilePackage fails without connection", async () => {
    const result = await executeCommand("oradev.compilePackage", ["my_pkg"], null);
    expect(result.success).toBe(false);
    expect(result.message).toContain("No active database connection");
  });

  it("showReferences succeeds (handled client-side)", async () => {
    const result = await executeCommand("oradev.showReferences", [], null);
    expect(result.success).toBe(true);
  });
});

// ─── 3. Unknown command ─────────────────────────────────────────────────────

describe("Unknown command", () => {
  it("returns failure for unknown command", async () => {
    const result = await executeCommand("oradev.nonExistent", [], null);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown command");
  });
});

// ─── 4. Missing arguments ───────────────────────────────────────────────────

describe("Missing arguments", () => {
  it("runStatement fails with no name argument", async () => {
    // Create a mock catalog that is connected
    const mockCatalog = { isConnected: true, execute: async () => [[]] } as any;
    const result = await executeCommand("oradev.runStatement", ["file:///test.sql"], mockCatalog);
    expect(result.success).toBe(false);
    expect(result.message).toContain("No statement name");
  });

  it("explainPlan fails with no statement argument", async () => {
    const mockCatalog = { isConnected: true, execute: async () => [[]] } as any;
    const result = await executeCommand("oradev.explainPlan", [], mockCatalog);
    expect(result.success).toBe(false);
    expect(result.message).toContain("No statement provided");
  });

  it("compilePackage fails with no package name", async () => {
    const mockCatalog = { isConnected: true, execute: async () => [[]] } as any;
    const result = await executeCommand("oradev.compilePackage", [], mockCatalog);
    expect(result.success).toBe(false);
    expect(result.message).toContain("No package name");
  });
});

// ─── 5. Successful execution with mock ──────────────────────────────────────

describe("Successful execution", () => {
  it("runStatement executes wrapped in BEGIN/END", async () => {
    let executedSql = "";
    const mockCatalog = {
      isConnected: true,
      execute: async (sql: string) => { executedSql = sql; return [["OK"]]; },
    } as any;
    const result = await executeCommand("oradev.runStatement", ["file:///test.sql", "my_proc"], mockCatalog);
    expect(result.success).toBe(true);
    expect(executedSql).toBe("BEGIN my_proc; END;");
  });

  it("compilePackage compiles spec and body", async () => {
    const executed: string[] = [];
    const mockCatalog = {
      isConnected: true,
      execute: async (sql: string) => { executed.push(sql); return [["OK"]]; },
    } as any;
    const result = await executeCommand("oradev.compilePackage", ["my_pkg"], mockCatalog);
    expect(result.success).toBe(true);
    expect(executed).toContain("ALTER PACKAGE my_pkg COMPILE");
    expect(executed).toContain("ALTER PACKAGE my_pkg COMPILE BODY");
  });
});
