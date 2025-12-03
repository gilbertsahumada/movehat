import config from "../src/movehat.config.js";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

const aptos = new Aptos(
    new AptosConfig({
        network: config.network as Network,
        fullnode: config.rpc,
    })
);

(async () => {
    console.log("Fetching account resources...");

    const result = await aptos.view({
        payload: {
            function: `${config.account}::counter::get`,
            typeArguments: [],
            functionArguments: [],
        }
    });

    console.log("Account resources fetched:");

    if(result[0] !== 0) {
        throw new Error(`Unexpected counter value: ${result[0]}`);
    }

    console.log("Test passed: Counter value is 0 as expected.");

})().catch((error: any) => {
    console.error("Test failed:", error);
    process.exit(1);
});