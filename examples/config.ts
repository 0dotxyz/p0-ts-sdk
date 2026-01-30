/**
 * Shared configuration for examples
 *
 * Loads configuration from environment variables.
 * Copy .env.example to .env and fill in your values.
 */

import { config } from "dotenv";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import path from "path";
import { fileURLToPath } from "url";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from examples directory
config({ path: path.join(__dirname, ".env") });

/**
 * Get required environment variable or throw error
 */
function getEnvVar(key: string, required: boolean = true): string {
  const value = process.env[key];
  if (!value && required) {
    throw new Error(
      `Missing required environment variable: ${key}\n` +
        `Please copy .env.example to .env and fill in your values.`
    );
  }
  return value || "";
}

/**
 * Solana RPC connection
 */
export function getConnection(): Connection {
  const rpcUrl = getEnvVar("SOLANA_RPC_URL");
  const commitment = getEnvVar("SOLANA_COMMITMENT", false) || "confirmed";
  return new Connection(rpcUrl, commitment as any);
}

/**
 * Marginfi configuration
 */
export function getMarginfiConfig() {
  return {
    environment: getEnvVar("MARGINFI_ENVIRONMENT") as any,
    groupPk: new PublicKey(getEnvVar("MARGINFI_GROUP_ADDRESS")),
    programId: new PublicKey(getEnvVar("MARGINFI_PROGRAM_ID")),
  };
}

/**
 * User's marginfi account address
 */
export function getAccountAddress(): PublicKey {
  return new PublicKey(getEnvVar("MARGINFI_ACCOUNT_ADDRESS"));
}

/**
 * User's wallet public key (for simulation/read-only operations)
 */
export function getWalletPubkey(): PublicKey {
  const pubkeyStr = getEnvVar("WALLET_ADDRESS");
  try {
    return new PublicKey(pubkeyStr);
  } catch (error) {
    throw new Error("Invalid WALLET_ADDRESS format. Expected base58 public key.");
  }
}

/**
 * User's wallet keypair (optional - only needed for actual transaction signing)
 */
export function getWallet(): Keypair | null {
  const privateKeyStr = getEnvVar("WALLET_PRIVATE_KEY", false);
  if (!privateKeyStr) {
    return null;
  }
  try {
    const privateKey = JSON.parse(privateKeyStr);
    return Keypair.fromSecretKey(Buffer.from(privateKey));
  } catch (error) {
    throw new Error("Invalid WALLET_PRIVATE_KEY format. Expected JSON array: [1,2,3,...]");
  }
}

/**
 * Common mint addresses
 */
export const MINTS = {
  USDC: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  SOL: new PublicKey("So11111111111111111111111111111111111111112"),
  JITOSOL: new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"),
  MSOL: new PublicKey("mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"),
  BSOL: new PublicKey("bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1"),
};

/**
 * Priority fee (optional)
 */
export function getPriorityFee(): number {
  const fee = getEnvVar("PRIORITY_FEE", false);
  return fee ? parseFloat(fee) : 0.00001;
}
