import { address, type Instruction, type TransactionSigner } from "@solana/kit";
import { getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { getTransferSolInstruction } from "@solana-program/system";

/**
 * Creates a compute budget instruction to set the priority fee for a transaction.
 * The priority fee is specified in micro-lamports per compute unit.
 *
 * @param priorityFeeMicro - Priority fee in micro-lamports per compute unit. If not provided, defaults to 1.
 * @returns A compute budget instruction with the specified priority fee
 */
export function makePriorityFeeMicroIx(priorityFeeMicro?: number): Instruction {
  return getSetComputeUnitPriceInstruction({
    microLamports: Math.floor(priorityFeeMicro ?? 1),
  });
}

/**
 * Creates a bundle tip instruction for Jito bundles.
 *
 * @param feePayer - Signer paying the tip
 * @param bundleTip - Tip in lamports
 */
export function makeBundleTipIx(
  feePayer: TransactionSigner,
  bundleTip: number = 100_000
): Instruction {
  const tipAccounts = [
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
  ];

  const tipAccount = tipAccounts[Math.floor(Math.random() * tipAccounts.length)];

  return getTransferSolInstruction({
    source: feePayer,
    destination: address(tipAccount),
    amount: bundleTip,
  });
}
