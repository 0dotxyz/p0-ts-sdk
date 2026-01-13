import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js";

/**
 * Creates a compute budget instruction to set the priority fee for a transaction.
 * The priority fee is specified in micro-lamports per compute unit.
 *
 * @param priorityFeeMicro - Priority fee in micro-lamports per compute unit. If not provided, defaults to 1.
 * @returns A compute budget instruction with the specified priority fee
 */
export function makePriorityFeeMicroIx(priorityFeeMicro?: number): TransactionInstruction {
  return ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: Math.floor(priorityFeeMicro ?? 1),
  });
}

/*
  deprecated use makePriorityFeeMicroIx instead
*/
export function makePriorityFeeIx(
  priorityFeeUi?: number,
  computeUnitsLimit?: number
): TransactionInstruction[] {
  const priorityFeeIx: TransactionInstruction[] = [];
  const limit = computeUnitsLimit ?? 1_400_000;

  let microLamports: number = 1;

  if (priorityFeeUi) {
    // if priority fee is above 0.2 SOL discard it for safety reasons
    const isAbsurdPriorityFee = priorityFeeUi > 0.1;

    if (!isAbsurdPriorityFee) {
      const priorityFeeMicroLamports = priorityFeeUi * LAMPORTS_PER_SOL * 1_000_000;
      microLamports = Math.round(priorityFeeMicroLamports / limit);
    }
  }

  priorityFeeIx.push(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports,
    })
  );

  return priorityFeeIx;
}

/**
 * @deprecated This method is deprecated.
 * Creates transaction priority instructions for different broadcast types.
 */
export function makeTxPriorityIx(
  feePayer: PublicKey,
  feeUi: number = 0,
  broadcastType: "BUNDLE" | "RPC" | "DYNAMIC"
) {
  let bundleTipIx: TransactionInstruction | undefined = undefined;
  let priorityFeeIx: TransactionInstruction = makePriorityFeeMicroIx();

  if (broadcastType === "BUNDLE") {
    bundleTipIx = makeBundleTipIx(feePayer, Math.trunc(feeUi * LAMPORTS_PER_SOL));
  } else {
    priorityFeeIx = makePriorityFeeMicroIx(feeUi);
  }

  return {
    bundleTipIx,
    priorityFeeIx,
  };
}

/**
 * Creates a bundle tip instruction for Jito bundles.
 */
export function makeBundleTipIx(
  feePayer: PublicKey,
  bundleTip: number = 100_000
): TransactionInstruction {
  // they have remained constant so function not used (for now)
  const getTipAccounts = async () => {
    const response = await fetch("https://mainnet.block-engine.jito.wtf/api/v1/bundles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTipAccounts",
        params: [],
      }),
    });
    return response.json();
  };

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

  const tipAccount = tipAccounts[Math.floor(Math.random() * tipAccounts.length)]!;

  const bundleTipInstruction = SystemProgram.transfer({
    fromPubkey: feePayer,
    toPubkey: new PublicKey(tipAccount),
    lamports: bundleTip,
  });

  return bundleTipInstruction;
}
