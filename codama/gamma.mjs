export default {
  idl: "../idls/gamma.json",
  before: [
    {
      from: "./visitors/keep-only.mjs#keepOnly",
      args: [
        {
          instructions: ["deposit", "withdraw", "completeWithdrawal"],
          accounts: ["depositPolicy", "lpVault", "withdrawReceipt", "withdrawalPolicy"],
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
