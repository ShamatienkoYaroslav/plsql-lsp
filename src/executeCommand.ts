import type { CatalogProvider } from "./catalogProvider.js";

// ─── Command names ─────────────────────────────────────────────────────────

export const COMMANDS = [
  "oradev.runStatement",
  "oradev.explainPlan",
  "oradev.compilePackage",
  "oradev.showReferences",
] as const;

export type CommandName = (typeof COMMANDS)[number];

// ─── Result ────────────────────────────────────────────────────────────────

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

// ─── Execute ───────────────────────────────────────────────────────────────

export async function executeCommand(
  command: string,
  args: unknown[] | undefined,
  catalog: CatalogProvider | null,
): Promise<CommandResult> {
  switch (command) {
    case "oradev.runStatement":
      return runStatement(args, catalog);
    case "oradev.explainPlan":
      return explainPlan(args, catalog);
    case "oradev.compilePackage":
      return compilePackage(args, catalog);
    case "oradev.showReferences":
      // Handled client-side; no server action needed
      return { success: true, message: "Handled by client" };
    default:
      return { success: false, message: `Unknown command: ${command}` };
  }
}

// ─── Run Statement ─────────────────────────────────────────────────────────

async function runStatement(
  args: unknown[] | undefined,
  catalog: CatalogProvider | null,
): Promise<CommandResult> {
  if (!catalog?.isConnected) {
    return { success: false, message: "No active database connection" };
  }

  const uri = args?.[0] as string | undefined;
  const name = args?.[1] as string | undefined;
  if (!name) {
    return { success: false, message: "No statement name provided" };
  }

  try {
    const result = await catalog.execute(`BEGIN ${name}; END;`);
    return { success: true, message: `Executed ${name}`, data: result };
  } catch (err) {
    return {
      success: false,
      message: `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Explain Plan ──────────────────────────────────────────────────────────

async function explainPlan(
  args: unknown[] | undefined,
  catalog: CatalogProvider | null,
): Promise<CommandResult> {
  if (!catalog?.isConnected) {
    return { success: false, message: "No active database connection" };
  }

  const statement = args?.[0] as string | undefined;
  if (!statement) {
    return { success: false, message: "No statement provided" };
  }

  try {
    const result = await catalog.execute(`EXPLAIN PLAN FOR ${statement}`);
    const plan = await catalog.execute(
      "SELECT plan_table_output FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', NULL, 'TYPICAL'))",
    );
    return { success: true, message: "Explain plan generated", data: plan };
  } catch (err) {
    return {
      success: false,
      message: `Error generating explain plan: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── Compile Package ───────────────────────────────────────────────────────

async function compilePackage(
  args: unknown[] | undefined,
  catalog: CatalogProvider | null,
): Promise<CommandResult> {
  if (!catalog?.isConnected) {
    return { success: false, message: "No active database connection" };
  }

  const packageName = args?.[0] as string | undefined;
  if (!packageName) {
    return { success: false, message: "No package name provided" };
  }

  try {
    await catalog.execute(`ALTER PACKAGE ${packageName} COMPILE`);
    await catalog.execute(`ALTER PACKAGE ${packageName} COMPILE BODY`);
    return { success: true, message: `Package ${packageName} compiled successfully` };
  } catch (err) {
    return {
      success: false,
      message: `Error compiling package ${packageName}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
