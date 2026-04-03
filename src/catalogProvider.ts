import { ChildProcess, spawn } from "child_process";
import { EventEmitter } from "events";
import {
  CatalogTable,
  CatalogColumn,
  CatalogObject,
  CatalogArgument,
  CatalogSource,
  CatalogCache,
} from "./catalogTypes.js";

const REQUEST_TIMEOUT_MS = 30_000;

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const fields: string[] = [];
    let i = 0;
    while (i < trimmed.length) {
      if (trimmed[i] === '"') {
        i++;
        let value = "";
        while (i < trimmed.length) {
          if (trimmed[i] === '"') {
            if (i + 1 < trimmed.length && trimmed[i + 1] === '"') {
              value += '"';
              i += 2;
            } else {
              i++;
              break;
            }
          } else {
            value += trimmed[i];
            i++;
          }
        }
        fields.push(value);
        if (i < trimmed.length && trimmed[i] === ",") i++;
      } else {
        let value = "";
        while (i < trimmed.length && trimmed[i] !== ",") {
          value += trimmed[i];
          i++;
        }
        fields.push(value);
        if (i < trimmed.length && trimmed[i] === ",") i++;
      }
    }
    rows.push(fields);
  }
  return rows;
}

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CatalogProvider extends EventEmitter {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";
  private cache: CatalogCache | null = null;
  private _connected = false;

  constructor(private sqlclPath: string = "sql") {
    super();
  }

  get isConnected(): boolean {
    return this._connected;
  }

  async start(): Promise<void> {
    this.process = spawn(this.sqlclPath, ["-mcp"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop()!;
      for (const line of lines) {
        if (line.trim().length > 0) {
          this.handleLine(line);
        }
      }
    });

    this.process.on("error", (err: Error) => {
      this._connected = false;
      this.rejectAll(err);
      this.emit("error", err);
    });

    this.process.on("exit", (code) => {
      this._connected = false;
      this.rejectAll(new Error(`SQLcl process exited with code ${code}`));
      this.emit("exit", code);
    });

    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "plsql-lsp", version: "0.1.0" },
    });

    this.sendNotification("notifications/initialized");
  }

  async connect(connectionName: string): Promise<void> {
    const result = await this.callTool("connect", {
      connection_name: connectionName,
    });
    if (result?.isError) {
      throw new Error(
        `Failed to connect: ${result.content?.[0]?.text ?? "unknown error"}`,
      );
    }
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    await this.callTool("disconnect", {});
    this._connected = false;
  }

  async execute(sql: string): Promise<string[][]> {
    if (!this._connected) throw new Error("Not connected");
    const result = await this.callTool("run-sql", { sql });
    const csvText: string = result?.content?.[0]?.text ?? "";
    return parseCSV(csvText);
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this._connected = false;
    this.rejectAll(new Error("CatalogProvider stopped"));
    this.cache = null;
  }

  async refresh(): Promise<void> {
    this.cache = {
      tables: new Map(),
      objects: new Map(),
      arguments: new Map(),
      source: new Map(),
      lastRefreshed: 0,
    };
    await this.refreshTables();
    await this.refreshColumns();
    await this.refreshObjects();
    await this.refreshArguments();
    this.cache.lastRefreshed = Date.now();
    this.emit("catalogRefreshed");
  }

  getTables(): CatalogTable[] {
    if (!this.cache) return [];
    return Array.from(this.cache.tables.values());
  }

  getTable(name: string): CatalogTable | undefined {
    return this.cache?.tables.get(name.toUpperCase());
  }

  getColumns(tableName: string): CatalogColumn[] {
    const table = this.getTable(tableName);
    return table?.columns ?? [];
  }

  getObject(name: string): CatalogObject | undefined {
    return this.cache?.objects.get(name.toUpperCase());
  }

  getObjects(type?: string): CatalogObject[] {
    if (!this.cache) return [];
    const all = Array.from(this.cache.objects.values());
    if (type) return all.filter((o) => o.objectType === type.toUpperCase());
    return all;
  }

  getArguments(objectName: string, packageName?: string): CatalogArgument[] {
    if (!this.cache) return [];
    const key = packageName
      ? `${packageName.toUpperCase()}.${objectName.toUpperCase()}`
      : objectName.toUpperCase();
    return this.cache.arguments.get(key) ?? [];
  }

  async getSource(
    name: string,
    type: string,
  ): Promise<CatalogSource | undefined> {
    if (!this.cache) return undefined;
    const key = `${type.toUpperCase()}:${name.toUpperCase()}`;
    const cached = this.cache.source.get(key);
    if (cached) return cached;

    const rows = await this.runSQL(
      `SELECT TEXT FROM USER_SOURCE WHERE NAME = '${name.toUpperCase()}' AND TYPE = '${type.toUpperCase()}' ORDER BY LINE`,
    );
    if (rows.length <= 1) return undefined;

    const lines = rows.slice(1).map((r) => r[0] ?? "");
    const source: CatalogSource = {
      name: name.toUpperCase(),
      type: type.toUpperCase(),
      lines,
    };
    this.cache.source.set(key, source);
    return source;
  }

  private async runSQL(sql: string): Promise<string[][]> {
    const result = await this.callTool("run-sql", { sql });
    const csvText: string = result?.content?.[0]?.text ?? "";
    return parseCSV(csvText);
  }

  private async refreshTables(): Promise<void> {
    const rows = await this.runSQL(
      "SELECT TABLE_NAME FROM USER_TABLES ORDER BY TABLE_NAME",
    );
    for (let i = 1; i < rows.length; i++) {
      const tableName = rows[i][0];
      if (tableName) {
        this.cache!.tables.set(tableName, { tableName, columns: [] });
      }
    }
  }

  private async refreshColumns(): Promise<void> {
    const rows = await this.runSQL(
      "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE FROM USER_TAB_COLUMNS ORDER BY TABLE_NAME, COLUMN_ID",
    );
    for (let i = 1; i < rows.length; i++) {
      const [tableName, columnName, dataType, dataLength, dataPrecision, dataScale, nullable] = rows[i];
      const col: CatalogColumn = {
        columnName,
        dataType,
        dataLength: dataLength ? Number(dataLength) : undefined,
        dataPrecision: dataPrecision ? Number(dataPrecision) : undefined,
        dataScale: dataScale ? Number(dataScale) : undefined,
        nullable: nullable !== "N",
        tableName,
      };
      const table = this.cache!.tables.get(tableName);
      if (table) {
        table.columns.push(col);
      }
    }
  }

  private async refreshObjects(): Promise<void> {
    const rows = await this.runSQL(
      "SELECT OBJECT_NAME, OBJECT_TYPE, STATUS FROM USER_OBJECTS WHERE OBJECT_TYPE IN ('PACKAGE','PACKAGE BODY','PROCEDURE','FUNCTION','TRIGGER','TYPE','TYPE BODY','SEQUENCE','SYNONYM','VIEW') ORDER BY OBJECT_NAME",
    );
    for (let i = 1; i < rows.length; i++) {
      const [objectName, objectType, status] = rows[i];
      if (objectName) {
        this.cache!.objects.set(objectName, { objectName, objectType, status });
      }
    }
  }

  private async refreshArguments(): Promise<void> {
    const rows = await this.runSQL(
      "SELECT OBJECT_NAME, PACKAGE_NAME, ARGUMENT_NAME, POSITION, DATA_TYPE, IN_OUT FROM USER_ARGUMENTS WHERE DATA_LEVEL = 0 ORDER BY OBJECT_NAME, POSITION",
    );
    for (let i = 1; i < rows.length; i++) {
      const [objectName, packageName, argumentName, position, dataType, inOut] = rows[i];
      const arg: CatalogArgument = {
        objectName,
        packageName: packageName || undefined,
        argumentName,
        position: Number(position),
        dataType,
        inOut,
      };
      const key = packageName
        ? `${packageName}.${objectName}`
        : objectName;
      const list = this.cache!.arguments.get(key);
      if (list) {
        list.push(arg);
      } else {
        this.cache!.arguments.set(key, [arg]);
      }
    }
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error("SQLcl process not running"));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      this.process.stdin.write(msg + "\n");
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    if (!this.process?.stdin?.writable) return;
    const msg = params
      ? JSON.stringify({ jsonrpc: "2.0", method, params })
      : JSON.stringify({ jsonrpc: "2.0", method });
    this.process.stdin.write(msg + "\n");
  }

  private handleLine(line: string): void {
    let msg: { id?: number; result?: unknown; error?: { message: string } };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id == null) return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(msg.id);
    if (msg.error) {
      pending.reject(new Error(msg.error.message));
    } else {
      pending.resolve(msg.result);
    }
  }

  private async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<any> {
    const result = await this.sendRequest("tools/call", {
      name: toolName,
      arguments: { ...args, model: "plsql-lsp" },
    });
    return result;
  }

  private rejectAll(err: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }
}
