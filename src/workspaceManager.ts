import { fileURLToPath } from "url";
import { loadConfig, ProjectConfig } from "./config.js";
import { CatalogProvider } from "./catalogProvider.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WorkspaceFolder {
  uri: string;
  name: string;
  config: ProjectConfig;
  catalogProvider: CatalogProvider | null;
}

// ─── Workspace Manager ─────────────────────────────────────────────────────

export class WorkspaceManager {
  private folders = new Map<string, WorkspaceFolder>();

  /** Get all workspace folders. */
  getFolders(): WorkspaceFolder[] {
    return [...this.folders.values()];
  }

  /** Get the workspace folder for a given document URI. */
  getFolderForDocument(documentUri: string): WorkspaceFolder | undefined {
    let best: WorkspaceFolder | undefined;
    let bestLen = 0;
    for (const folder of this.folders.values()) {
      if (documentUri.startsWith(folder.uri) && folder.uri.length > bestLen) {
        best = folder;
        bestLen = folder.uri.length;
      }
    }
    return best;
  }

  /** Get the catalog provider for a given document URI. */
  getCatalogForDocument(documentUri: string): CatalogProvider | undefined {
    const folder = this.getFolderForDocument(documentUri);
    return folder?.catalogProvider ?? undefined;
  }

  /** Add a workspace folder. */
  async addFolder(uri: string, name: string): Promise<WorkspaceFolder> {
    if (this.folders.has(uri)) return this.folders.get(uri)!;

    const workspacePath = uri.startsWith("file://") ? fileURLToPath(uri) : uri;
    const config = loadConfig(workspacePath);

    const folder: WorkspaceFolder = {
      uri,
      name,
      config,
      catalogProvider: null,
    };

    this.folders.set(uri, folder);
    return folder;
  }

  /** Remove a workspace folder and disconnect its catalog. */
  async removeFolder(uri: string): Promise<void> {
    const folder = this.folders.get(uri);
    if (!folder) return;

    if (folder.catalogProvider) {
      try { await folder.catalogProvider.disconnect(); } catch {}
      folder.catalogProvider.stop();
    }

    this.folders.delete(uri);
  }

  /** Connect a workspace folder to a database. */
  async connectFolder(
    uri: string,
    connectionName: string,
    sqlclPath?: string,
  ): Promise<void> {
    const folder = this.folders.get(uri);
    if (!folder) return;

    if (folder.catalogProvider) {
      try { await folder.catalogProvider.disconnect(); } catch {}
      folder.catalogProvider.stop();
    }

    const provider = new CatalogProvider(sqlclPath ?? folder.config.sqlclPath ?? "sql");
    await provider.start();
    await provider.connect(connectionName);
    await provider.refresh();
    folder.catalogProvider = provider;
  }

  /** Disconnect all workspace folders. */
  async disconnectAll(): Promise<void> {
    for (const folder of this.folders.values()) {
      if (folder.catalogProvider) {
        try { await folder.catalogProvider.disconnect(); } catch {}
        folder.catalogProvider.stop();
        folder.catalogProvider = null;
      }
    }
  }

  /** Get a combined catalog provider — returns the first connected one, or undefined. */
  getAnyCatalog(): CatalogProvider | undefined {
    for (const folder of this.folders.values()) {
      if (folder.catalogProvider?.isConnected) return folder.catalogProvider;
    }
    return undefined;
  }
}
