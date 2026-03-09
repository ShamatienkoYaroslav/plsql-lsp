import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    conditions: ["node"],
    extensions: [".ts", ".js"],
    alias: [
      // Resolve .js imports to .ts source files
      { find: /^(.*)\.js$/, replacement: "$1.ts" },
    ],
  },
});
