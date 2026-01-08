import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 60000, // 60s for integration tests
    hookTimeout: 60000,
  },
});
