import {
  address,
  createNoopSigner,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  isSignerRole,
  isWritableRole,
  type Instruction,
} from "@solana/kit";
import { describe, expect, it } from "vitest";

import {
  deriveGammaWithdrawEscrow,
  makeGammaCompleteWithdrawalIx,
  makeGammaDepositIx,
  makeGammaWithdrawIx,
} from "~/vendor/gamma";

// Wire format recorded from the hand-written web3.js builders these replaced; never update with `-u`.

const key = (fill: number) => getAddressDecoder().decode(new Uint8Array(32).fill(fill));
const toWire = (ix: Instruction) => ({
  programId: ix.programAddress,
  keys: (ix.accounts ?? []).map((a) => [a.address, isSignerRole(a.role), isWritableRole(a.role)]),
  data: Buffer.from(ix.data ?? []).toString("hex"),
});

const user = createNoopSigner(key(1));
const lpVault = key(2);
const assetsAccount = key(3);
const assetsMint = key(4);
const sharesMint = key(5);
const feeRecipient = key(6);

const tokenAccount = async (owner: typeof lpVault, mint: typeof lpVault) =>
  (
    await getProgramDerivedAddress({
      programAddress: address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
      seeds: [
        getAddressEncoder().encode(owner),
        getAddressEncoder().encode(address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")),
        getAddressEncoder().encode(mint),
      ],
    })
  )[0];

const cases: Record<string, () => Promise<Instruction>> = {
  deposit: () =>
    makeGammaDepositIx({
      user,
      lpVault,
      assetsAccount,
      assetsMint,
      sharesMint,
      amount: 1234n,
    }),
  withdraw: async () =>
    makeGammaWithdrawIx({
      user,
      lpVault,
      assetsAccount,
      assetsMint,
      sharesMint,
      feeRecipientAccount: await tokenAccount(feeRecipient, sharesMint),
      sharesAmount: 5678n,
    }),
  completeWithdrawal: async () => {
    const [withdrawEscrow] = await deriveGammaWithdrawEscrow(user.address, lpVault);
    return makeGammaCompleteWithdrawalIx({
      user,
      lpVault,
      assetsMint,
      sharesMint,
      escrowAssetsAccount: await tokenAccount(withdrawEscrow, assetsMint),
      escrowSharesAccount: await tokenAccount(withdrawEscrow, sharesMint),
    });
  },
};

describe("gamma instruction wire format", () => {
  it.each(Object.entries(cases))("%s", async (_, build) => {
    expect(toWire(await build())).toMatchSnapshot();
  });
});
