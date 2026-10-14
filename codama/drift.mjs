import { accountNode, structFieldTypeNode, structTypeNode } from "@codama/nodes";

export default {
  idl: "../idls/drift.json",
  before: [
    {
      from: "@codama/visitors#updateProgramsVisitor",
      args: [{ drift: { publicKey: "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH" } }],
    },
    {
      from: "@codama/visitors#bottomUpTransformerVisitor",
      args: [
        [
          {
            // LPPool declares `padding` twice in the upstream IDL.
            select: "[accountNode]lPPool",
            transform: (node) => {
              const fields = node.data.fields;
              const last = fields.findLastIndex((field) => field.name === "padding");
              return accountNode({
                ...node,
                data: structTypeNode(
                  fields.map((field, i) =>
                    i === last ? structFieldTypeNode({ ...field, name: "trailingPadding" }) : field
                  )
                ),
              });
            },
          },
        ],
      ],
    },
    {
      // Drift was exploited; the SDK only needs to value and refresh the frozen banks
      from: "./keep-only.mjs#keepOnly",
      args: [
        {
          instructions: ["updateSpotMarketCumulativeInterest"],
          accounts: ["spotMarket", "user", "userStats"],
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
          generatedFolder: "src/generated/drift",
          kitImportStrategy: "rootOnly",
          syncPackageJson: false,
        },
      ],
    },
  },
};
