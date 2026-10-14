export default {
  idl: "../idls/kfarms.json",
  before: [
    {
      from: "@codama/visitors#updateProgramsVisitor",
      args: [{ farms: { publicKey: "FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr" } }],
    },
    {
      from: "./visitors/keep-only.mjs#keepOnly",
      args: [
        {
          accounts: ["farmState"],
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
          generatedFolder: "src/generated/kfarms",
          kitImportStrategy: "rootOnly",
          syncPackageJson: false,
        },
      ],
    },
  },
};
