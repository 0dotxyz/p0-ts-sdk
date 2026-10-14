import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    // Mirror the tsconfig `~/* -> src/*` path alias.
    alias: [{ find: /^~\//, replacement: `${srcDir}/` }],
  },
  test: {
    // Tests live in a top-level `tests/` tree mirroring `src/` (keeps `src`
    // shippable-clean). They import source via the `~` alias above.
    include: ["tests/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/generated/**"],
      reporter: ["text-summary", "json-summary", "html"],
      // Ratchet: raise these to the new floor whenever coverage goes up, never lower them
      thresholds: { lines: 69, branches: 59, functions: 65, statements: 69 },
    },
  },
});
