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
  },
});
