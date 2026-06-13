import {
  Account,
  Aptos,
  type InputViewFunctionData,
  type MoveFunctionId,
} from "@aptos-labs/ts-sdk";
import { logger } from "../ui/index.js";
import { traceTransaction } from "./trace/client.js";
import { renderTrace } from "./trace/renderer.js";

export interface TransactionResult {
  hash: string;
  success: boolean;
  vm_status: string;
}

export class MoveContract {
  constructor(
    private aptos: Aptos,
    private moduleAddress: string,
    private moduleName: string,
    // movelite RPC base (ending in `/v1`). Presence enables Foundry-style
    // execution traces at verbosity level >= 2. Undefined on the Movement node
    // (no trace endpoint) — calls use the normal submit path.
    private traceRpcUrl?: string
  ) {}

  async call(
    signer: Account,
    functionName: string,
    // any[]: Move entry-function arguments are heterogeneous primitives
    // (u8/u64/string/bool/address/vector) passed through to the Aptos
    // SDK's `functionArguments`, which validates at submit time. A
    // narrower union here would force casts at every call site for
    // little safety gain.
    args: any[] = [],
    typeArgs: string[] = []
  ): Promise<TransactionResult> {
    const functionFullName = `${this.moduleAddress}::${this.moduleName}::${functionName}`;

    logger.step(`Calling ${functionFullName}...`);

    const transaction = await this.aptos.transaction.build.simple({
      sender: signer.accountAddress,
      data: {
        function: functionFullName as MoveFunctionId,
        typeArguments: typeArgs,
        functionArguments: args,
      },
    });

    const signature = this.aptos.transaction.sign({
      signer,
      transaction,
    });

    // Trace path: on movelite at raised verbosity, route through the
    // instrumented `/transactions/trace?commit=true` endpoint, which executes
    // AND commits in one pass (so we must NOT also submit), then render the
    // returned call tree.
    const traceLevel = logger.getVerbosityLevel();
    if (this.traceRpcUrl && traceLevel >= 2) {
      const { response, elapsedMs } = await traceTransaction({
        rpcUrl: this.traceRpcUrl,
        transaction,
        senderAuthenticator: signature,
      });

      // A render failure must never fail a transaction that already committed.
      try {
        renderTrace(response, { level: traceLevel, elapsedMs });
      } catch (renderError) {
        const msg =
          renderError instanceof Error ? renderError.message : String(renderError);
        logger.warning(`Failed to render trace: ${msg}`);
      }

      logger.success(
        `Transaction ${response.txn_hash} committed with status: ${response.vm_status}`
      );
      logger.newline();

      return {
        hash: response.txn_hash,
        success: response.success,
        vm_status: response.vm_status,
      };
    }

    const committedTxn = await this.aptos.transaction.submit.simple({
      transaction,
      senderAuthenticator: signature,
    });

    const response = await this.aptos.waitForTransaction({
      transactionHash: committedTxn.hash,
    });

    logger.success(
      `Transaction ${committedTxn.hash} committed with status: ${response.vm_status}`
    );
    logger.newline();

    return {
      hash: committedTxn.hash,
      success: response.success,
      vm_status: response.vm_status,
    };
  }

  async view<T = unknown>(
    functionName: string,
    // any[]: see `call()` above — Move view-function arguments share
    // the same SDK-validated boundary semantics.
    args: any[] = [],
    typeArgs: string[] = []
  ): Promise<T> {
    const functionFullName = `${this.moduleAddress}::${this.moduleName}::${functionName}`;

    const payload: InputViewFunctionData = {
      function: functionFullName as MoveFunctionId,
      typeArguments: typeArgs,
      functionArguments: args,
    };

    const result = await this.aptos.view({ payload });

    return (result.length === 1 ? result[0] : result) as T;
  }

  getModuleId(): string {
    return `${this.moduleAddress}::${this.moduleName}`;
  }
}

export function getContract(
    aptos: Aptos,
    moduleAddress: string,
    moduleName: string,
    traceRpcUrl?: string
): MoveContract {
    return new MoveContract(aptos, moduleAddress, moduleName, traceRpcUrl);
}