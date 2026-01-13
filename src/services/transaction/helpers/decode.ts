import { BorshInstructionCoder, Idl, Instruction } from "@coral-xyz/anchor";
import {
  VersionedTransaction,
  AddressLookupTableAccount,
  TransactionMessage,
} from "@solana/web3.js";

/**
 * Decodes a Solana transaction instruction using the provided Interface Definition Language (IDL).
 * This function utilizes the BorshInstructionCoder to interpret the encoded instruction data.
 *
 * @param idl - The Interface Definition Language object that defines the structure of the instruction.
 * @param encoded - The Buffer containing the encoded instruction data.
 * @returns The decoded instruction object.
 */
export function decodeInstruction(idl: Idl, encoded: Buffer): Instruction | null {
  const coder = new BorshInstructionCoder(idl);
  return coder.decode(encoded, "base58");
}

/**
 * Decompiles a VersionedTransaction into a TransactionMessage.
 *
 * @param tx - The VersionedTransaction to be decompiled.
 * @param lookupTableAccounts - An array of AddressLookupTableAccount used for decompiling the transaction message.
 * @returns A TransactionMessage object representing the decompiled transaction.
 */
export function decompileV0Transaction(
  tx: VersionedTransaction,
  lookupTableAccounts: AddressLookupTableAccount[]
) {
  return TransactionMessage.decompile(tx.message, {
    addressLookupTableAccounts: lookupTableAccounts,
  });
}
