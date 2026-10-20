export default {
  idl: "../idls/jup-lend.json",
  before: [
    {
      from: "./visitors/keep-only.mjs#keepOnly",
      args: [
        {
          instructions: ["updateRate"],
          accounts: ["lending", "lendingRewardsRateModel"],
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
          generatedFolder: "src/generated/jup-lend",
          kitImportStrategy: "rootOnly",
          syncPackageJson: false,
        },
      ],
    },
  },
};
