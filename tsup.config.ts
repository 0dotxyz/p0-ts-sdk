import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    vendor: "src/vendor/index.ts",
    jupiter: "src/vendor/jupiter/index.ts",
    instructions: "src/instructions.ts",
  },
  outDir: "dist",
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  external: [
    "@coral-xyz/anchor",
    "@solana/kit",
    "@solana/web3.js",
    "bignumber.js",
    "bn.js",
    "decimal.js",
    "superstruct",
    "ws",
    "@msgpack/msgpack",
  ],
});
