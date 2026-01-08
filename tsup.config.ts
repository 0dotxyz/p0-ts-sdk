import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    vendor: "src/vendor/index.ts",
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
    "@coral-xyz/borsh",
    "@mrgnlabs/mrgn-common",
    "@solana/web3.js",
    "@switchboard-xyz/on-demand",
    "@switchboard-xyz/common",
    "@jup-ag/api",
    "bignumber.js",
    "borsh",
    "bs58",
    "bn.js",
    "decimal.js",
    "superstruct",
  ],
});
