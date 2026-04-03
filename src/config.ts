import { readFileSync } from "fs";
import { join } from "path";
import { DiagnosticSeverity } from "vscode-languageserver/node";

// ─── SQLcl Format Options (from .dbtools/project.sqlformat.xml) ─────────

export interface SqlFormatOptions {
  kwCase?: "upper" | "lower" | "preserve";
  idCase?: "upper" | "lower" | "preserve";
  identSpaces?: number;
  useTab?: boolean;
  maxCharLineSize?: number;
  breaksComma?: "before" | "after" | "none";
  spaceAfterCommas?: boolean;
  breaksAfterSelect?: boolean;
  alignTabColAliases?: boolean;
  alignAssignments?: boolean;
  alignTypeDecl?: boolean;
  alignNamedArgs?: boolean;
  spaceAroundOperators?: boolean;
}

// ─── Project Config (from .dbtools/project.config.json) ─────────────────

export interface ProjectConfig {
  sqlclPath?: string;
  connectionName?: string;
  schemas?: string[];
  formatting?: SqlFormatOptions;
  diagnostics?: {
    unknownTableSeverity?: "error" | "warning" | "info" | "hint" | "off";
    unknownColumnSeverity?: "error" | "warning" | "info" | "hint" | "off";
    unusedVariableSeverity?: "error" | "warning" | "info" | "hint" | "off";
  };
}

const DEFAULT_CONFIG: ProjectConfig = {};

export function mapSeverity(
  value: string | undefined,
  fallback: DiagnosticSeverity,
): DiagnosticSeverity | null {
  switch (value) {
    case "error":
      return DiagnosticSeverity.Error;
    case "warning":
      return DiagnosticSeverity.Warning;
    case "info":
      return DiagnosticSeverity.Information;
    case "hint":
      return DiagnosticSeverity.Hint;
    case "off":
      return null;
    default:
      return fallback;
  }
}

// ─── Load Config ────────────────────────────────────────────────────────

export function loadConfig(workspaceRoot: string | null): ProjectConfig {
  if (!workspaceRoot) return DEFAULT_CONFIG;

  const config: ProjectConfig = {};

  // Read .dbtools/project.config.json
  try {
    const configPath = join(workspaceRoot, ".dbtools", "project.config.json");
    const content = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content);

    if (parsed.sqlcl?.connectionName) {
      config.connectionName = parsed.sqlcl.connectionName;
    }
    if (parsed.sqlcl?.version) {
      // sqlclPath can be derived if needed; keep it optional
    }
    if (Array.isArray(parsed.schemas)) {
      config.schemas = parsed.schemas;
    }
  } catch {
    // No .dbtools/project.config.json found — continue with defaults
  }

  // Read .dbtools/project.sqlformat.xml
  try {
    const formatPath = join(workspaceRoot, ".dbtools", "project.sqlformat.xml");
    const xml = readFileSync(formatPath, "utf-8");
    config.formatting = parseSqlFormatXml(xml);
  } catch {
    // No format file found — continue with defaults
  }

  return config;
}

// ─── Parse SQLcl Format XML ─────────────────────────────────────────────

function getXmlValue(xml: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`);
  const match = xml.match(regex);
  return match?.[1];
}

function parseCaseValue(value: string | undefined): "upper" | "lower" | "preserve" | undefined {
  if (!value) return undefined;
  if (value.includes("UPPER") || value.includes("upper")) return "upper";
  if (value.includes("LOWER") || value.includes("lower")) return "lower";
  if (value.includes("INIT_CAP") || value.includes("init_cap")) return "preserve";
  return "preserve";
}

function parseBreaksComma(value: string | undefined): "before" | "after" | "none" | undefined {
  if (!value) return undefined;
  if (value.includes("Before")) return "before";
  if (value.includes("After")) return "after";
  if (value.includes("None")) return "none";
  return undefined;
}

export function parseSqlFormatXml(xml: string): SqlFormatOptions {
  const opts: SqlFormatOptions = {};

  opts.kwCase = parseCaseValue(getXmlValue(xml, "kwCase"));
  opts.idCase = parseCaseValue(getXmlValue(xml, "idCase"));

  const identSpaces = getXmlValue(xml, "identSpaces");
  if (identSpaces) opts.identSpaces = parseInt(identSpaces, 10);

  const useTab = getXmlValue(xml, "useTab");
  if (useTab) opts.useTab = useTab === "true";

  const maxCharLineSize = getXmlValue(xml, "maxCharLineSize");
  if (maxCharLineSize) opts.maxCharLineSize = parseInt(maxCharLineSize, 10);

  opts.breaksComma = parseBreaksComma(getXmlValue(xml, "breaksComma"));

  const spaceAfterCommas = getXmlValue(xml, "spaceAfterCommas");
  if (spaceAfterCommas) opts.spaceAfterCommas = spaceAfterCommas === "true";

  const breaksAfterSelect = getXmlValue(xml, "breaksAfterSelect");
  if (breaksAfterSelect) opts.breaksAfterSelect = breaksAfterSelect === "true";

  const alignTabColAliases = getXmlValue(xml, "alignTabColAliases");
  if (alignTabColAliases) opts.alignTabColAliases = alignTabColAliases === "true";

  const alignAssignments = getXmlValue(xml, "alignAssignments");
  if (alignAssignments) opts.alignAssignments = alignAssignments === "true";

  const alignTypeDecl = getXmlValue(xml, "alignTypeDecl");
  if (alignTypeDecl) opts.alignTypeDecl = alignTypeDecl === "true";

  const alignNamedArgs = getXmlValue(xml, "alignNamedArgs");
  if (alignNamedArgs) opts.alignNamedArgs = alignNamedArgs === "true";

  const spaceAroundOperators = getXmlValue(xml, "spaceAroundOperators");
  if (spaceAroundOperators) opts.spaceAroundOperators = spaceAroundOperators === "true";

  return opts;
}
