export default {
  idl: "../idls/marginfi.json",
  scripts: {
    js: {
      from: "@codama/renderers-js",
      args: [
        ".",
        {
          generatedFolder: "src/generated/marginfi",
          kitImportStrategy: "rootOnly",
          syncPackageJson: false,
          // The `MarginfiAccount` account type collides with the default `<Program>Account` enum.
          nameTransformers: { programAccountsEnum: () => "MarginfiAccountType" },
        },
      ],
    },
  },
};
