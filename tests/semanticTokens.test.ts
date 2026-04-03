import { describe, it, expect } from "vitest";
import { parseDocument } from "../src/parser/index";
import { getSemanticTokens, tokenTypes, tokenModifiers } from "../src/semanticTokens";

// ─── Test helpers ─────────────────────────────────────────────────────────────

interface DecodedToken {
  line: number;
  col: number;
  length: number;
  tokenType: string;
  modifiers: string[];
}

function decodeTokens(data: number[]): DecodedToken[] {
  const tokens: DecodedToken[] = [];
  let prevLine = 0;
  let prevCol = 0;
  for (let i = 0; i < data.length; i += 5) {
    const deltaLine = data[i];
    const deltaCol = data[i + 1];
    const length = data[i + 2];
    const typeIdx = data[i + 3];
    const modBits = data[i + 4];

    const line = prevLine + deltaLine;
    const col = deltaLine === 0 ? prevCol + deltaCol : deltaCol;

    const mods: string[] = [];
    for (let b = 0; b < tokenModifiers.length; b++) {
      if (modBits & (1 << b)) mods.push(tokenModifiers[b]);
    }

    tokens.push({ line, col, length, tokenType: tokenTypes[typeIdx], modifiers: mods });
    prevLine = line;
    prevCol = col;
  }
  return tokens;
}

function getTokens(sql: string): DecodedToken[] {
  const { ast } = parseDocument(sql);
  return decodeTokens(getSemanticTokens(ast, sql));
}

// ─── 1. Variable declaration and reference ───────────────────────────────────

describe("Variable declaration and reference", () => {
  const sql = "CREATE PROCEDURE p AS v_count NUMBER; BEGIN v_count := 1; END;";

  it("v_count declaration has tokenType 'variable'", () => {
    const tokens = getTokens(sql);
    const decl = tokens.find(t => t.tokenType === "variable" && t.modifiers.includes("declaration"));
    expect(decl).toBeDefined();
    expect(decl!.tokenType).toBe("variable");
  });

  it("v_count declaration has 'declaration' modifier", () => {
    const tokens = getTokens(sql);
    const decl = tokens.find(t => t.tokenType === "variable" && t.modifiers.includes("declaration"));
    expect(decl).toBeDefined();
    expect(decl!.modifiers).toContain("declaration");
  });

  it("v_count reference has tokenType 'variable'", () => {
    const tokens = getTokens(sql);
    const ref = tokens.find(t => t.tokenType === "variable" && !t.modifiers.includes("declaration"));
    expect(ref).toBeDefined();
    expect(ref!.tokenType).toBe("variable");
  });

  it("v_count reference does NOT have 'declaration' modifier", () => {
    const tokens = getTokens(sql);
    const ref = tokens.find(t => t.tokenType === "variable" && !t.modifiers.includes("declaration"));
    expect(ref).toBeDefined();
    expect(ref!.modifiers).not.toContain("declaration");
  });

  it("procedure name p has tokenType 'method' with 'declaration' modifier", () => {
    const tokens = getTokens(sql);
    const proc = tokens.find(t => t.tokenType === "method" && t.modifiers.includes("declaration"));
    expect(proc).toBeDefined();
    expect(proc!.tokenType).toBe("method");
    expect(proc!.modifiers).toContain("declaration");
  });
});

// ─── 2. Parameter tokens ─────────────────────────────────────────────────────

describe("Parameter tokens", () => {
  const sql = "CREATE PROCEDURE p (p_id IN NUMBER) AS BEGIN NULL; END;";

  it("p_id declaration has tokenType 'parameter'", () => {
    const tokens = getTokens(sql);
    const param = tokens.find(t => t.tokenType === "parameter" && t.modifiers.includes("declaration"));
    expect(param).toBeDefined();
    expect(param!.tokenType).toBe("parameter");
  });

  it("p_id declaration has 'declaration' modifier", () => {
    const tokens = getTokens(sql);
    const param = tokens.find(t => t.tokenType === "parameter" && t.modifiers.includes("declaration"));
    expect(param).toBeDefined();
    expect(param!.modifiers).toContain("declaration");
  });
});

// ─── 3. Constant gets readonly modifier ──────────────────────────────────────

describe("Constant gets readonly modifier", () => {
  const sql = "CREATE PROCEDURE p AS c_max CONSTANT NUMBER := 100; BEGIN NULL; END;";

  it("c_max declaration has tokenType 'variable'", () => {
    const tokens = getTokens(sql);
    const constant = tokens.find(
      t => t.tokenType === "variable" && t.modifiers.includes("declaration") && t.modifiers.includes("readonly")
    );
    expect(constant).toBeDefined();
    expect(constant!.tokenType).toBe("variable");
  });

  it("c_max declaration has 'declaration' modifier", () => {
    const tokens = getTokens(sql);
    const constant = tokens.find(
      t => t.tokenType === "variable" && t.modifiers.includes("declaration") && t.modifiers.includes("readonly")
    );
    expect(constant).toBeDefined();
    expect(constant!.modifiers).toContain("declaration");
  });

  it("c_max declaration has 'readonly' modifier", () => {
    const tokens = getTokens(sql);
    const constant = tokens.find(
      t => t.tokenType === "variable" && t.modifiers.includes("declaration") && t.modifiers.includes("readonly")
    );
    expect(constant).toBeDefined();
    expect(constant!.modifiers).toContain("readonly");
  });
});

// ─── 4. Cursor tokens ────────────────────────────────────────────────────────

describe("Cursor tokens", () => {
  const sql = "CREATE PROCEDURE p AS CURSOR c_emp IS SELECT 1 FROM dual; BEGIN OPEN c_emp; END;";

  it("c_emp declaration has tokenType 'interface'", () => {
    const tokens = getTokens(sql);
    const decl = tokens.find(t => t.tokenType === "interface" && t.modifiers.includes("declaration"));
    expect(decl).toBeDefined();
    expect(decl!.tokenType).toBe("interface");
  });

  it("c_emp declaration has 'declaration' modifier", () => {
    const tokens = getTokens(sql);
    const decl = tokens.find(t => t.tokenType === "interface" && t.modifiers.includes("declaration"));
    expect(decl).toBeDefined();
    expect(decl!.modifiers).toContain("declaration");
  });

  it("c_emp reference has tokenType 'interface' with no declaration modifier", () => {
    const tokens = getTokens(sql);
    const ref = tokens.find(t => t.tokenType === "interface" && !t.modifiers.includes("declaration"));
    expect(ref).toBeDefined();
    expect(ref!.tokenType).toBe("interface");
    expect(ref!.modifiers).not.toContain("declaration");
  });
});

// ─── 5. Exception tokens ─────────────────────────────────────────────────────

describe("Exception tokens", () => {
  const sql = "CREATE PROCEDURE p AS e_custom EXCEPTION; BEGIN RAISE e_custom; END;";

  it("e_custom declaration has tokenType 'event'", () => {
    const tokens = getTokens(sql);
    const decl = tokens.find(t => t.tokenType === "event" && t.modifiers.includes("declaration"));
    expect(decl).toBeDefined();
    expect(decl!.tokenType).toBe("event");
  });

  it("e_custom declaration has 'declaration' modifier", () => {
    const tokens = getTokens(sql);
    const decl = tokens.find(t => t.tokenType === "event" && t.modifiers.includes("declaration"));
    expect(decl).toBeDefined();
    expect(decl!.modifiers).toContain("declaration");
  });

  it("e_custom reference has tokenType 'event'", () => {
    const tokens = getTokens(sql);
    const ref = tokens.find(t => t.tokenType === "event" && !t.modifiers.includes("declaration"));
    expect(ref).toBeDefined();
    expect(ref!.tokenType).toBe("event");
  });
});

// ─── 6. Function tokens ──────────────────────────────────────────────────────

describe("Function tokens", () => {
  const sql = "CREATE FUNCTION f RETURN NUMBER AS BEGIN RETURN 1; END;";

  it("f declaration has tokenType 'function'", () => {
    const tokens = getTokens(sql);
    const decl = tokens.find(t => t.tokenType === "function" && t.modifiers.includes("declaration"));
    expect(decl).toBeDefined();
    expect(decl!.tokenType).toBe("function");
  });

  it("f declaration has 'declaration' modifier", () => {
    const tokens = getTokens(sql);
    const decl = tokens.find(t => t.tokenType === "function" && t.modifiers.includes("declaration"));
    expect(decl).toBeDefined();
    expect(decl!.modifiers).toContain("declaration");
  });
});

// ─── 7. Delta encoding is correct ────────────────────────────────────────────

describe("Delta encoding is correct", () => {
  const sql = "CREATE PROCEDURE p AS v_x NUMBER; BEGIN v_x := 1; END;";

  it("raw data array length is a multiple of 5", () => {
    const { ast } = parseDocument(sql);
    const data = getSemanticTokens(ast, sql);
    expect(data.length % 5).toBe(0);
  });

  it("decoding and re-encoding produces the same array", () => {
    const { ast } = parseDocument(sql);
    const data = getSemanticTokens(ast, sql);
    const decoded = decodeTokens(data);

    // Re-encode
    const reEncoded: number[] = [];
    let prevLine = 0;
    let prevCol = 0;
    for (const tok of decoded) {
      const deltaLine = tok.line - prevLine;
      const deltaCol = deltaLine === 0 ? tok.col - prevCol : tok.col;
      const typeIdx = tokenTypes.indexOf(tok.tokenType);
      let modBits = 0;
      for (let b = 0; b < tokenModifiers.length; b++) {
        if (tok.modifiers.includes(tokenModifiers[b])) modBits |= (1 << b);
      }
      reEncoded.push(deltaLine, deltaCol, tok.length, typeIdx, modBits);
      prevLine = tok.line;
      prevCol = tok.col;
    }

    expect(reEncoded).toEqual(data);
  });

  it("every deltaLine is non-negative", () => {
    const { ast } = parseDocument(sql);
    const data = getSemanticTokens(ast, sql);
    for (let i = 0; i < data.length; i += 5) {
      expect(data[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it("every token length is positive", () => {
    const { ast } = parseDocument(sql);
    const data = getSemanticTokens(ast, sql);
    for (let i = 2; i < data.length; i += 5) {
      expect(data[i]).toBeGreaterThan(0);
    }
  });
});

// ─── 8. Empty/no symbols ─────────────────────────────────────────────────────

describe("Empty/no symbols", () => {
  const sql = "BEGIN NULL; END;";

  it("returns an array with length that is a multiple of 5", () => {
    const { ast } = parseDocument(sql);
    const data = getSemanticTokens(ast, sql);
    expect(data.length % 5).toBe(0);
  });

  it("returns no tokens (or very few — no user-declared symbols)", () => {
    const tokens = getTokens(sql);
    // No variable/parameter/function/cursor/exception declarations expected
    const symbolTokens = tokens.filter(t =>
      ["variable", "parameter", "function", "method", "interface", "event"].includes(t.tokenType)
    );
    expect(symbolTokens.length).toBe(0);
  });
});

// ─── 9. Multiple tokens on same line ─────────────────────────────────────────

describe("Multiple tokens on same line", () => {
  const sql = "CREATE PROCEDURE p AS v_a NUMBER; v_b NUMBER; BEGIN NULL; END;";

  it("both v_a and v_b declaration tokens appear", () => {
    const tokens = getTokens(sql);
    const varDecls = tokens.filter(t => t.tokenType === "variable" && t.modifiers.includes("declaration"));
    expect(varDecls.length).toBeGreaterThanOrEqual(2);
  });

  it("tokens on the same line have deltaLine=0 in the raw data", () => {
    const { ast } = parseDocument(sql);
    const data = getSemanticTokens(ast, sql);

    // Find two consecutive 5-tuples on the same line
    const decoded = decodeTokens(data);
    let foundSameLine = false;
    for (let i = 1; i < decoded.length; i++) {
      if (decoded[i].line === decoded[i - 1].line) {
        foundSameLine = true;
        // The raw deltaLine for this token (at position i*5) must be 0
        expect(data[i * 5]).toBe(0);
      }
    }
    // The snippet has multiple declarations; at minimum the procedure name and one variable share a line check
    // We assert the encoding rule held for every pair we found
    expect(foundSameLine || decoded.length <= 1).toBe(true);
  });

  it("deltaStartChar for same-line tokens is relative to previous token column", () => {
    const { ast } = parseDocument(sql);
    const data = getSemanticTokens(ast, sql);
    const decoded = decodeTokens(data);

    for (let i = 1; i < decoded.length; i++) {
      if (decoded[i].line === decoded[i - 1].line) {
        const expectedDeltaCol = decoded[i].col - decoded[i - 1].col;
        expect(data[i * 5 + 1]).toBe(expectedDeltaCol);
      }
    }
  });

  it("deltaStartChar for tokens on different lines is absolute column", () => {
    const { ast } = parseDocument(sql);
    const data = getSemanticTokens(ast, sql);
    const decoded = decodeTokens(data);

    for (let i = 1; i < decoded.length; i++) {
      if (decoded[i].line !== decoded[i - 1].line) {
        expect(data[i * 5 + 1]).toBe(decoded[i].col);
      }
    }
  });
});

// ─── 10. For loop variable ───────────────────────────────────────────────────

describe("For loop variable", () => {
  const sql = "CREATE PROCEDURE p AS BEGIN FOR i IN 1..10 LOOP NULL; END LOOP; END;";

  it("loop counter i appears as a token", () => {
    const tokens = getTokens(sql);
    const loopVar = tokens.find(t => t.tokenType === "variable" && t.modifiers.includes("declaration"));
    expect(loopVar).toBeDefined();
  });

  it("loop counter i declaration has tokenType 'variable'", () => {
    const tokens = getTokens(sql);
    // The procedure name is 'method'; any variable declaration here must be i
    const varDecls = tokens.filter(t => t.tokenType === "variable" && t.modifiers.includes("declaration"));
    expect(varDecls.length).toBeGreaterThanOrEqual(1);
    expect(varDecls[0].tokenType).toBe("variable");
  });

  it("loop counter i declaration has 'declaration' modifier", () => {
    const tokens = getTokens(sql);
    const varDecls = tokens.filter(t => t.tokenType === "variable" && t.modifiers.includes("declaration"));
    expect(varDecls.length).toBeGreaterThanOrEqual(1);
    expect(varDecls[0].modifiers).toContain("declaration");
  });
});

// ─── 11. Token ordering ──────────────────────────────────────────────────────

describe("Token ordering", () => {
  const sql = "CREATE PROCEDURE p AS v_x NUMBER; BEGIN v_x := 1; END;";

  it("decoded tokens are sorted by line ascending", () => {
    const tokens = getTokens(sql);
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i].line).toBeGreaterThanOrEqual(tokens[i - 1].line);
    }
  });

  it("decoded tokens on same line are sorted by column ascending", () => {
    const tokens = getTokens(sql);
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i].line === tokens[i - 1].line) {
        expect(tokens[i].col).toBeGreaterThanOrEqual(tokens[i - 1].col);
      }
    }
  });
});

// ─── 12. Legend arrays are well-formed ───────────────────────────────────────

describe("Legend arrays", () => {
  it("tokenTypes is a non-empty array of strings", () => {
    expect(Array.isArray(tokenTypes)).toBe(true);
    expect(tokenTypes.length).toBeGreaterThan(0);
    for (const t of tokenTypes) {
      expect(typeof t).toBe("string");
    }
  });

  it("tokenModifiers is a non-empty array of strings", () => {
    expect(Array.isArray(tokenModifiers)).toBe(true);
    expect(tokenModifiers.length).toBeGreaterThan(0);
    for (const m of tokenModifiers) {
      expect(typeof m).toBe("string");
    }
  });

  it("tokenTypes contains 'variable' at index 0", () => {
    expect(tokenTypes[0]).toBe("variable");
  });

  it("tokenTypes contains 'parameter' at index 1", () => {
    expect(tokenTypes[1]).toBe("parameter");
  });

  it("tokenTypes contains 'function' at index 2", () => {
    expect(tokenTypes[2]).toBe("function");
  });

  it("tokenTypes contains 'method' at index 3", () => {
    expect(tokenTypes[3]).toBe("method");
  });

  it("tokenTypes contains 'interface' at index 8", () => {
    expect(tokenTypes[8]).toBe("interface");
  });

  it("tokenModifiers contains 'declaration' at index 0", () => {
    expect(tokenModifiers[0]).toBe("declaration");
  });

  it("tokenModifiers contains 'readonly' at index 1", () => {
    expect(tokenModifiers[1]).toBe("readonly");
  });
});
