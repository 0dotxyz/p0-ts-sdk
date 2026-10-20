import {
  getBase64EncodedWireTransaction,
  type Address,
  type Transaction,
  type TransactionError,
} from "@solana/kit";

class BundleSimulationError extends Error {
  constructor(
    message: string,
    public readonly logs?: string[],
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "BundleSimulationError";
  }

  static fromHttpError(status: number, statusText: string): BundleSimulationError {
    return new BundleSimulationError(`HTTP error ${status}: ${statusText}`);
  }

  static fromEncodingError(error: unknown, index?: number): BundleSimulationError {
    return new BundleSimulationError(
      `Failed to encode transaction${index !== undefined ? ` at index ${index}` : "s"}`
    );
  }
}

type JsonRpcResponse<T> =
  | {
      id: number;
      jsonrpc: string;
      result: { context: { slot: number }; value: T };
    }
  | {
      id: number;
      jsonrpc: string;
      error: { code: number; message: string; data?: unknown };
    };

interface RpcSimulateBundleResult {
  summary:
    | "succeeded"
    | {
        failed: {
          error: any;
          txSignature?: string;
        };
      };
  transactionResults: RpcSimulateBundleTransactionResult[];
}

interface RpcSimulateBundleTransactionResult {
  err?: TransactionError;
  logs: string[];
  preExecutionAccounts?: any; //UiAccount[],
  postExecutionAccounts?: any; //UiAccount[],
  unitsConsumed?: string;
  returnData?: any; //UiTransactionReturnData,
}

interface RpcSimulateBundleConfig {
  preExecutionAccountsConfigs: (RpcSimulateTransactionAccountsConfig | undefined)[];
  postExecutionAccountsConfigs: (RpcSimulateTransactionAccountsConfig | undefined)[];
  transactionEncoding?: any;
  simulationBank?: SimulationSlotConfig;
  skipSigVerify?: boolean;
  replaceRecentBlockhash?: boolean;
}

interface RpcSimulateTransactionAccountsConfig {
  encoding?: any; // UiAccountEncoding,
  addresses: string[];
}

type SimulationSlotConfig = "confirmed" | "processed" | number;

export async function simulateBundle(
  rpcEndpoint: string,
  transactions: Transaction[],
  includeAccounts?: Array<Address>
): Promise<RpcSimulateBundleTransactionResult[]> {
  // Validate input
  if (!transactions.length) {
    throw new BundleSimulationError("No bundle provided for simulation");
  }

  try {
    // Prepare transaction data
    const encodedTransactions = encodeTransactions(transactions);
    const config = createBundleConfig(transactions, includeAccounts);

    // Execute simulation
    const result = await executeBundleSimulation(rpcEndpoint, encodedTransactions, config);

    return result;
  } catch (error) {
    if (error instanceof BundleSimulationError) {
      throw error;
    } else {
      throw new BundleSimulationError("Failed to execute bundle simulation", undefined, error);
    }
  }
}

function encodeTransactions(transactions: Transaction[]): string[] {
  try {
    return transactions.map((tx, index) => {
      try {
        return getBase64EncodedWireTransaction(tx);
      } catch (error) {
        throw BundleSimulationError.fromEncodingError(error, index);
      }
    });
  } catch (error) {
    if (error instanceof BundleSimulationError) throw error;
    throw BundleSimulationError.fromEncodingError(error);
  }
}

function createBundleConfig(
  transactions: Transaction[],
  includeAccounts?: Array<Address>
): RpcSimulateBundleConfig {
  return {
    skipSigVerify: true,
    replaceRecentBlockhash: true,
    preExecutionAccountsConfigs: transactions.map(() => ({ addresses: [] })),
    postExecutionAccountsConfigs: transactions.map((_, index) => ({
      addresses: index === transactions.length - 1 && includeAccounts ? includeAccounts : [],
    })),
  };
}

async function executeBundleSimulation(
  rpcEndpoint: string,
  encodedTransactions: string[],
  config: RpcSimulateBundleConfig
): Promise<RpcSimulateBundleTransactionResult[]> {
  const response = await fetch(rpcEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "simulateBundle",
      params: [{ encodedTransactions }, config],
    }),
  });

  if (!response.ok) {
    throw BundleSimulationError.fromHttpError(response.status, response.statusText);
  }

  const jsonResponse = (await response.json()) as JsonRpcResponse<RpcSimulateBundleResult>;

  if ("error" in jsonResponse) {
    throw jsonResponse.error;
  }

  const value = jsonResponse.result.value;

  if (value.summary !== "succeeded") {
    const logs = value.transactionResults.flatMap((tx) => tx.logs);

    throw new BundleSimulationError(JSON.stringify(value.summary.failed.error), logs);
  }

  return value.transactionResults;
}
