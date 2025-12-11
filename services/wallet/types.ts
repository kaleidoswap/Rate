export enum WalletType {
    SPARK = 'spark',
    LIQUID = 'liquid',
    ARKADE = 'arkade',
}

export interface Balance {
    confirmed: number;
    unconfirmed: number;
    spendable: number;
    currency: string;
}

export interface Transaction {
    txid: string;
    amount: number;
    fee?: number;
    timestamp: number;
    type: 'send' | 'receive';
    status: 'pending' | 'confirmed' | 'failed';
    description?: string;
    paymentHash?: string; // For Lightning
}

export interface WalletAdapter {
    type: WalletType;

    initialize(mnemonic: string, config?: any): Promise<void>;
    disconnect(): Promise<void>;

    getBalance(): Promise<Balance>;
    getTransactions(): Promise<Transaction[]>;

    // Basic send/receive
    // Note: These might need to be more specific per adapter (e.g. invoices vs onchain addresses)
    // but we define a generic interface for highest level abstraction
    receive(amount?: number): Promise<string>; // Returns address or invoice
    send(destination: string, amount: number, feeRate?: number): Promise<string>; // Returns txid or preimage

    // Sync
    sync(): Promise<void>;
}

export interface WalletManagerConfig {
    network: 'mainnet' | 'testnet' | 'regtest' | 'signet';
    breezApiKey?: string;
    greenlightInviteCode?: string; // For Spark
}
