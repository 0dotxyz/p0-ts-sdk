export default {
  idl: "../idls/pyth-receiver.json",
  before: [
    {
      from: "@codama/visitors#updateProgramsVisitor",
      args: [{ pythSolanaReceiver: { publicKey: "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ" } }],
    },
    {
      // Admin-only; its `Config` argument is an account struct the legacy IDL never declares as a type.
      from: "@codama/visitors#deleteNodesVisitor",
      args: [["[instructionNode]initialize"]],
    },
  ],
  scripts: {
    js: {
      from: "@codama/renderers-js",
      args: [
        ".",
        {
          generatedFolder: "src/generated/pyth-receiver",
          kitImportStrategy: "rootOnly",
          syncPackageJson: false,
        },
      ],
    },
  },
};
