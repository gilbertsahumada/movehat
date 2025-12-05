export interface MovehatConfig {
    network: string;
    rpc: string;
    privateKey: string;
    profile: string;
    moveDir: string;
    account: string;
    namedAddresses?: Record<string, string>;
}