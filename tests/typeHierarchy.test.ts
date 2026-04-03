import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";
import { prepareTypeHierarchy, getSupertypes, getSubtypes } from "../src/typeHierarchy";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function prepare(sql: string, name: string) {
  const { ast } = parseDocument(sql);
  const offset = sql.indexOf(name);
  return prepareTypeHierarchy(ast, sql, offset, "file:///test.sql");
}

function supertypes(sql: string, name: string) {
  const { ast } = parseDocument(sql);
  const items = prepareTypeHierarchy(ast, sql, sql.indexOf(name), "file:///test.sql");
  if (!items || items.length === 0) return [];
  return getSupertypes(items[0], ast, sql, "file:///test.sql");
}

function subtypes(sql: string, name: string) {
  const { ast } = parseDocument(sql);
  const items = prepareTypeHierarchy(ast, sql, sql.indexOf(name), "file:///test.sql");
  if (!items || items.length === 0) return [];
  return getSubtypes(items[0], ast, sql, "file:///test.sql");
}

// ─── 1. Prepare ───────────────────────────────────────────────────────────────

describe("prepareTypeHierarchy", () => {
  it("returns an item for a type declaration", () => {
    const sql = "CREATE TYPE animal_t AS OBJECT (name VARCHAR2(100)) NOT FINAL;";
    const items = prepare(sql, "animal_t");
    expect(items).not.toBeNull();
    expect(items!.length).toBe(1);
    expect(items![0].name).toBe("animal_t");
  });

  it("returns null for unknown identifier", () => {
    const sql = "CREATE TYPE animal_t AS OBJECT (name VARCHAR2(100));";
    const items = prepare(sql, "unknown");
    expect(items).toBeNull();
  });

  it("returns null for a non-type identifier", () => {
    const sql = "CREATE PROCEDURE p AS BEGIN NULL; END;";
    const items = prepare(sql, "p");
    expect(items).toBeNull();
  });
});

// ─── 2. Supertypes ───────────────────────────────────────────────────────────

describe("getSupertypes", () => {
  const sql = `CREATE TYPE animal_t AS OBJECT (name VARCHAR2(100)) NOT FINAL;
CREATE TYPE dog_t UNDER animal_t (breed VARCHAR2(50));`;

  it("finds the parent type", () => {
    const parents = supertypes(sql, "dog_t");
    expect(parents.length).toBe(1);
    expect(parents[0].name).toBe("animal_t");
  });

  it("returns empty for a root type", () => {
    const parents = supertypes(sql, "animal_t");
    expect(parents.length).toBe(0);
  });
});

// ─── 3. Subtypes ────────────────────────────────────────────────────────────

describe("getSubtypes", () => {
  const sql = `CREATE TYPE animal_t AS OBJECT (name VARCHAR2(100)) NOT FINAL;
CREATE TYPE dog_t UNDER animal_t (breed VARCHAR2(50));
CREATE TYPE cat_t UNDER animal_t (indoor CHAR(1));`;

  it("finds all child types", () => {
    const children = subtypes(sql, "animal_t");
    expect(children.length).toBe(2);
    const names = children.map(c => c.name);
    expect(names).toContain("dog_t");
    expect(names).toContain("cat_t");
  });

  it("returns empty for a leaf type", () => {
    const children = subtypes(sql, "dog_t");
    expect(children.length).toBe(0);
  });
});

// ─── 4. Three-level hierarchy ───────────────────────────────────────────────

describe("Multi-level hierarchy", () => {
  const sql = `CREATE TYPE base_t AS OBJECT (id NUMBER) NOT FINAL;
CREATE TYPE mid_t UNDER base_t (name VARCHAR2(50)) NOT FINAL;
CREATE TYPE leaf_t UNDER mid_t (detail VARCHAR2(100));`;

  it("mid type has base_t as parent", () => {
    const parents = supertypes(sql, "mid_t");
    expect(parents.length).toBe(1);
    expect(parents[0].name).toBe("base_t");
  });

  it("mid type has leaf_t as child", () => {
    const children = subtypes(sql, "mid_t");
    expect(children.length).toBe(1);
    expect(children[0].name).toBe("leaf_t");
  });

  it("base type has mid_t as direct child only", () => {
    const children = subtypes(sql, "base_t");
    expect(children.length).toBe(1);
    expect(children[0].name).toBe("mid_t");
  });
});
