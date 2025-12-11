import {
    connect,
    BreezSdk,
    ConnectRequest,
    defaultConfig,
    EnvironmentType,
    NodeConfig,
    mnemonicToSeed
} from '@breeztech/breez-sdk-spark-react-native';
import * as FileSystem from 'expo-file-system';
import { WalletAdapter, WalletType, Balance, Transaction } from './types';

export class SparkWalletAdapter implements WalletAdapter {
    type = WalletType.SPARK;
    private sdk: BreezSdk | null = null;
    private initialized = false;

    async initialize(mnemonic: string, config?: { apiKey?: string; inviteCode?: string }): Promise<void> {
        if (this.initialized && this.sdk) return;

        try {
            console.log('Initializing Spark Wallet...');

            const seed = await mnemonicToSeed(mnemonic);
            const network = EnvironmentType.PRODUCTION; // Default to mainnet/production for now, or make configurable

            const nodeConfig: NodeConfig = {
                type: 'greenlight',
                config: {
                    inviteCode: config?.inviteCode,
                }
            };

            const sdkConfig = await defaultConfig(
                network,
                config?.apiKey || '',
                nodeConfig
            );

            // Unique storage per network/wallet
            const docDir = FileSystem.documentDirectory || '';
            const storageDir = `${docDir}breez_spark`;
            await FileSystem.makeDirectoryAsync(storageDir, { intermediates: true });
            sdkConfig.workingDir = storageDir;

            const connectRequest: ConnectRequest = {
                config: sdkConfig,
                seed: seed,
                // restoreOnly: false, // Optional
            };

            this.sdk = await connect(connectRequest);
            this.initialized = true;
            console.log('Spark Wallet initialized successfully');

            // Start the node (if needed, usually connect starts it)
            // await this.sdk.start(); 
        } catch (error) {
            console.error('Failed to initialize Spark Wallet:', error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        if (this.sdk) {
            await this.sdk.disconnect();
            this.sdk = null;
            this.initialized = false;
        }
    }

    async getBalance(): Promise<Balance> {
        if (!this.sdk) throw new Error('Spark SDK not initialized');

        const nodeInfo = await this.sdk.nodeInfo();
        // Spark/Lightning balance logic
        // Usually onchain + ln balance
        const lnBalance = nodeInfo.channelsBalanceMsat / 1000; // convert to sats
        const onchainBalance = nodeInfo.onchainBalanceMsat / 1000;

        return {
            confirmed: Math.floor(lnBalance + onchainBalance), // Simplify for now
            unconfirmed: 0,
            spendable: Math.floor(lnBalance), // Simplification: mostly LN is spendable instantly
            currency: 'SAT',
        };
    }

    async getTransactions(): Promise<Transaction[]> {
        if (!this.sdk) throw new Error('Spark SDK not initialized');

        // Spark SDK usually has payments() or transactions() methods
        // Placeholder assuming generic Breez patterns
        // Need to verify exact API match, but this is a structure placeholder
        /*
        const payments = await this.sdk.listPayments({});
        return payments.map(p => ({
          txid: p.paymentHash,
          amount: p.amountMsat / 1000,
          timestamp: p.paymentTime,
          type: p.paymentType === 'received' ? 'receive' : 'send',
          status: p.status === 'complete' ? 'confirmed' : 'pending',
          description: p.description,
        }));
        */
        return [];
    }

    async receive(amount?: number): Promise<string> {
        if (!this.sdk) throw new Error('Spark SDK not initialized');

        const invoice = await this.sdk.receivePayment({
            amountMsat: amount ? amount * 1000 : 0,
            description: 'Incoming payment',
        });

        return invoice.lnInvoice.bolt11;
    }

    async send(destination: string, amount: number): Promise<string> {
        if (!this.sdk) throw new Error('Spark SDK not initialized');

        // Assume bolt11 for now
        const response = await this.sdk.sendPayment({
            bolt11: destination,
            amountMsat: amount ? amount * 1000 : undefined, // If amount is encoded in invoice, this might be optional or override
        });

        return response.payment.paymentHash;
    }

    async sync(): Promise<void> {
        if (!this.sdk) return;
        // Breez SDK usually syncs automatically or via specific calls
        // await this.sdk.sync(); // if available
        await this.sdk.nodeInfo(); // trigger refresh
    }
}
