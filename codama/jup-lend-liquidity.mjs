export default {
  idl: "../idls/jup-lend-liquidity.json",
  before: [
    {
      from: "./visitors/keep-only.mjs#keepOnly",
      args: [
        {
          accounts: ["rateModel", "tokenReserve"],
        },
      ],
    },
  ],
  scripts: {
    js: {
      from: "@codama/renderers-js",
      args: [
        ".",
        {
          generatedFolder: "src/generated/jup-lend-liquidity",
          kitImportStrategy: "rootOnly",
          syncPackageJson: false,
        },
      ],
    },
  },
};
