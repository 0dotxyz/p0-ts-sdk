// Vendored from @solana/spl-single-pool 3.0.0 (github.com/solana-program/single-pool, Apache-2.0),
// ported to @solana/kit 8 and trimmed to what the SDK uses; its branded address subtypes are plain
// `Address`. Not a dependency because it pins @solana/* 6.8.0, which would bundle a second Kit.
export * from "./addresses";
export * from "./instructions";
