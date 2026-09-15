import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts"],
      thresholds: { statements: 80, branches: 70, functions: 80, lines: 80 }
    }
  }
});
