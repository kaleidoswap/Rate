import {
    connect,
    BreezSdkLiquid,
    ConnectRequest,
    defaultConfig,
    LiquidNetwork,
} from '@breeztech/react-native-breez-sdk-liquid';
import * as FileSystem from 'expo-file-system';
import { WalletAdapter, WalletType, Balance, Transaction } from './types';

export class LiquidWalletAdapter implements WalletAdapter {
    type = WalletType.LIQUID;
    private sdk: BreezSdkLiquid | null = null;
    private initialized = false;

    async initialize(mnemonic: string, config?: { apiKey?: string }): Promise<void> {
        if (this.initialized && this.sdk) return;

        try {
            console.log('Initializing Liquid Wallet...');

            const network = LiquidNetwork.MAINNET;

            // Check if SDK has defaultConfig method
            // Assuming similar API to Spark
            const sdkConfig = await defaultConfig(
                network,
                config?.apiKey // Optional
            );

            const docDir = FileSystem.documentDirectory || '';
            const storageDir = `${docDir}breez_liquid`;
            await FileSystem.makeDirectoryAsync(storageDir, { intermediates: true });
            sdkConfig.workingDir = storageDir;

            const connectRequest: ConnectRequest = {
                config: sdkConfig,
                mnemonic: mnemonic, // Liquid SDK might take mnemonic directly in connect request
            };

            this.sdk = await connect(connectRequest);
            this.initialized = true;
            console.log('Liquid Wallet initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Liquid Wallet:', error);
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
        if (!this.sdk) throw new Error('Liquid SDK not initialized');

        const info = await this.sdk.getInfo();
        // Liquid has asset balances. We need to sum up or find the primary asset (L-BTC)
        // Placeholder logic:
        const lbtc = info.walletInfo.balanceSat;

        return {
            confirmed: lbtc,
            unconfirmed: 0, // usually pending included
            spendable: lbtc,
            currency: 'L-BTC',
        };
    }

    async getTransactions(): Promise<Transaction[]> {
        if (!this.sdk) throw new Error('Liquid SDK not initialized');

        const payments = await this.sdk.listPayments({});
        return payments.map((p: any) => ({
            txid: p.txId || p.paymentHash || '',
            amount: p.amountSat,
            timestamp: p.timestamp,
            type: p.paymentType === 'receive' ? 'receive' : 'send',
            status: p.status === 'complete' ? 'confirmed' : 'pending',
            description: p.details?.description,
        }));
    }

    async receive(amount?: number): Promise<string> {
        if (!this.sdk) throw new Error('Liquid SDK not initialized');

        // Receive via Lightning/Boltz swap probably? Or Liquid address?
        // Liquid SDK usually handles swaps.
        // For pure liquid: 
        const response = await this.sdk.receivePayment({
            amount: { amountSat: amount || 0 },
            description: "Liquid payment" // Optional
            // useDescriptionHash: false
        });

        return response.destination; // Might be a swap address or LN invoice if configured
    }

    async send(destination: string, amount: number): Promise<string> {
        if (!this.sdk) throw new Error('Liquid SDK not initialized');

        const response = await this.sdk.sendPayment({
            destination: destination,
            amount: { amountSat: amount }, // if destination is invoice, amount might be optional
        });

        return response.payment.txId || response.payment.paymentHash || '';
    }

    async sync(): Promise<void> {
        if (!this.sdk) return;
        // await this.sdk.sync();
    }
}
