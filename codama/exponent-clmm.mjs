export default {
  idl: "../idls/exponent_clmm.json",
  before: [
    {
      // The IDL's U256 fixed-point type is named `Number`, shadowing the JS global.
      from: "@codama/visitors#updateDefinedTypesVisitor",
      args: [{ number: { name: "preciseNumber" } }],
    },
  ],
  scripts: {
    js: {
      from: "@codama/renderers-js",
      args: [
        ".",
        {
          generatedFolder: "src/generated/exponent-clmm",
          kitImportStrategy: "rootOnly",
          syncPackageJson: false,
        },
      ],
    },
  },
};
