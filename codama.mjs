import { accountNode, structTypeNode, structFieldTypeNode } from "@codama/nodes";

export default {
  idl: "src/idl/marginfi_0.1.11.json",
  before: [
    {
      from: "@codama/visitors#bottomUpTransformerVisitor",
      args: [
        [
          {
            // Bank has both `_pad0` and `_pad_0` (after `rate_limiter`); both camelCase to `pad0`.
            select: "[accountNode]bank",
            transform: (node) => {
              const fields = node.data.fields;
              const second = fields.findLastIndex((field) => field.name === "pad0");
              return accountNode({
                ...node,
                data: structTypeNode(
                  fields.map((field, i) =>
                    i === second ? structFieldTypeNode({ ...field, name: "padAfterRateLimiter" }) : field
                  )
                ),
              });
            },
          },
        ],
      ],
    },
  ],
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
