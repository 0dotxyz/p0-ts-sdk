export default {
  idl: "../idls/scope.json",
  before: [
    {
      from: "@codama/visitors#updateProgramsVisitor",
      args: [{ scope: { publicKey: "HFn8GnPADiny6XqUoWE8uRPPxb29ikn4yTuPa9MF2fWJ" } }],
    },
  ],
  scripts: {
    js: {
      from: "@codama/renderers-js",
      args: [
        ".",
        {
          generatedFolder: "src/generated/scope",
          kitImportStrategy: "rootOnly",
          syncPackageJson: false,
        },
      ],
    },
  },
};
