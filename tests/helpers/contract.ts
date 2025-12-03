import {
  Account,
  Aptos,
  type InputViewFunctionData,
  type MoveFunctionId,
} from "@aptos-labs/ts-sdk";

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
    args: any[] = [],
    typeArgs: string[] = []
  ): Promise<TransactionResult> {
    const functionFullName = `${this.moduleAddress}::${this.moduleName}::${functionName}`;

    console.log(`📝 Calling ${functionFullName}...`);

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

    console.log(
      `✅ Transaction ${committedTxn.hash} committed with status: ${response.vm_status}\n`
    );

    return {
      hash: committedTxn.hash,
      success: response.success,
      vm_status: response.vm_status,
    };
  }

  async view<T = any>(
    functionName: string,
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

/**
 * Factory function para crear una instancia de contrato
 */
export function getContract(
    aptos: Aptos,
    moduleAddress: string,
    moduleName: string
): MoveContract {
    return new MoveContract(aptos, moduleAddress, moduleName);
}