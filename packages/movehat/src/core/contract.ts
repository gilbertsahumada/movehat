import {
  Account,
  Aptos,
  type InputViewFunctionData,
  type MoveFunctionId,
} from "@aptos-labs/ts-sdk";
import { logger } from "../ui/index.js";

export interface TransactionResult {
  hash: string;
  success: boolean;
  vm_status: string;
}

export class MoveContract {
  constructor(
    private aptos: Aptos,
    private moduleAddress: string,
    private moduleName: string
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
    moduleName: string
): MoveContract {
    return new MoveContract(aptos, moduleAddress, moduleName);
}