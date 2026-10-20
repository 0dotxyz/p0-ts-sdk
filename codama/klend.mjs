export default {
  idl: "../idls/klend.json",
  before: [
    {
      from: "@codama/visitors#updateProgramsVisitor",
      args: [{ kaminoLending: { publicKey: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD" } }],
    },
    {
      from: "./visitors/keep-only.mjs#keepOnly",
      args: [
        {
          instructions: ["refreshReserve", "refreshObligation", "refreshReservesBatch"],
          accounts: ["reserve", "obligation"],
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
          generatedFolder: "src/generated/klend",
          kitImportStrategy: "rootOnly",
          syncPackageJson: false,
        },
      ],
    },
  },
};
