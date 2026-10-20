export default {
  idl: "../idls/gamma.json",
  before: [
    {
      from: "./visitors/keep-only.mjs#keepOnly",
      args: [
        {
          instructions: ["deposit", "withdraw", "completeWithdrawal"],
          accounts: ["lpVault", "withdrawReceipt"],
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
          generatedFolder: "src/generated/gamma",
          kitImportStrategy: "rootOnly",
          syncPackageJson: false,
        },
      ],
    },
  },
};
