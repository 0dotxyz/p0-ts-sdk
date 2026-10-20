import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    vendor: "src/vendor/index.ts",
    jupiter: "src/vendor/jupiter/index.ts",
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
    "@solana/kit",
    "bignumber.js",
    "decimal.js",
    "superstruct",
    "ws",
    "@msgpack/msgpack",
  ],
});
