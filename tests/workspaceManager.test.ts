import { describe, it, expect } from "vitest";
import { WorkspaceManager } from "../src/workspaceManager";

// ─── 1. Basic folder management ─────────────────────────────────────────────

describe("WorkspaceManager folder management", () => {
  it("starts with no folders", () => {
    const wm = new WorkspaceManager();
    expect(wm.getFolders().length).toBe(0);
  });

  it("adds a folder", async () => {
    const wm = new WorkspaceManager();
    const folder = await wm.addFolder("file:///workspace/project1", "project1");
    expect(folder.uri).toBe("file:///workspace/project1");
    expect(folder.name).toBe("project1");
    expect(wm.getFolders().length).toBe(1);
  });

  it("does not duplicate folders with same URI", async () => {
    const wm = new WorkspaceManager();
    await wm.addFolder("file:///workspace/project1", "project1");
    await wm.addFolder("file:///workspace/project1", "project1");
    expect(wm.getFolders().length).toBe(1);
  });

  it("removes a folder", async () => {
    const wm = new WorkspaceManager();
    await wm.addFolder("file:///workspace/project1", "project1");
    await wm.removeFolder("file:///workspace/project1");
    expect(wm.getFolders().length).toBe(0);
  });

  it("removing non-existent folder is a no-op", async () => {
    const wm = new WorkspaceManager();
    await wm.removeFolder("file:///nonexistent");
    expect(wm.getFolders().length).toBe(0);
  });
});

// ─── 2. Document to folder mapping ──────────────────────────────────────────

describe("Document to folder mapping", () => {
  it("maps document to correct workspace folder", async () => {
    const wm = new WorkspaceManager();
    await wm.addFolder("file:///workspace/project1", "project1");
    await wm.addFolder("file:///workspace/project2", "project2");

    const folder = wm.getFolderForDocument("file:///workspace/project1/src/main.sql");
    expect(folder).toBeDefined();
    expect(folder!.name).toBe("project1");
  });

  it("maps document to longest matching folder URI", async () => {
    const wm = new WorkspaceManager();
    await wm.addFolder("file:///workspace", "root");
    await wm.addFolder("file:///workspace/nested", "nested");

    const folder = wm.getFolderForDocument("file:///workspace/nested/file.sql");
    expect(folder).toBeDefined();
    expect(folder!.name).toBe("nested");
  });

  it("returns undefined for unmapped document", async () => {
    const wm = new WorkspaceManager();
    await wm.addFolder("file:///workspace/project1", "project1");

    const folder = wm.getFolderForDocument("file:///other/file.sql");
    expect(folder).toBeUndefined();
  });
});

// ─── 3. Catalog provider per folder ─────────────────────────────────────────

describe("Catalog provider per folder", () => {
  it("newly added folder has no catalog", async () => {
    const wm = new WorkspaceManager();
    await wm.addFolder("file:///workspace/project1", "project1");
    expect(wm.getCatalogForDocument("file:///workspace/project1/file.sql")).toBeUndefined();
  });

  it("getAnyCatalog returns undefined when no catalogs connected", () => {
    const wm = new WorkspaceManager();
    expect(wm.getAnyCatalog()).toBeUndefined();
  });
});

// ─── 4. Multiple folders ────────────────────────────────────────────────────

describe("Multiple workspace folders", () => {
  it("supports multiple independent folders", async () => {
    const wm = new WorkspaceManager();
    await wm.addFolder("file:///workspace/hr", "HR Schema");
    await wm.addFolder("file:///workspace/finance", "Finance Schema");
    await wm.addFolder("file:///workspace/common", "Common Utils");

    expect(wm.getFolders().length).toBe(3);

    const hrFolder = wm.getFolderForDocument("file:///workspace/hr/packages/emp_pkg.sql");
    expect(hrFolder!.name).toBe("HR Schema");

    const finFolder = wm.getFolderForDocument("file:///workspace/finance/views/budget_v.sql");
    expect(finFolder!.name).toBe("Finance Schema");
  });
});
