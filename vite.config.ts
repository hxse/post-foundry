import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", ".bun-install/**", ".bun-tmp/**", "dist/**", "build/**"],
    globals: true
  }
});
