import { readFile } from "node:fs/promises";

import { defineConfig } from "tsup";

import { trimIdl } from "./build/idl-trim";

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
  esbuildPlugins: [
    {
      name: "idl-trim",
      setup(build) {
        build.onLoad({ filter: /\/(idl\/[^/]+|idl)\.json$/ }, async (args) => ({
          contents: JSON.stringify(
            trimIdl(JSON.parse(await readFile(args.path, "utf8")), args.path)
          ),
          loader: "json",
        }));
      },
    },
  ],
  external: [
    "@coral-xyz/anchor",
    "@coral-xyz/borsh",
    "@solana/web3.js",
    "@switchboard-xyz/on-demand",
    "@switchboard-xyz/common",
    "bignumber.js",
    "borsh",
    "bs58",
    "bn.js",
    "decimal.js",
    "superstruct",
    "ws",
    "@msgpack/msgpack",
  ],
});
