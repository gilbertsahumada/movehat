export interface MovehatConfig {
    network: string;
    rpc: string;
    privateKey: string;
    profile: string;
    moveDir: string;
    namedAddresses?: Record<string, string>;
}