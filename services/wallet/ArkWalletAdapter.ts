import {
    Wallet,
    SingleKey,
    InMemoryStorageAdapter
} from '@arkade-os/sdk';
import { ExpoArkProvider, ExpoIndexerProvider } from '@arkade-os/sdk/adapters/expo';
import { WalletAdapter, WalletType, Balance, Transaction } from './types';
import * as Crypto from 'expo-crypto';

// Polyfill ensure
if (!global.crypto) global.crypto = {} as any;
if (!global.crypto.getRandomValues) {
    global.crypto.getRandomValues = Crypto.getRandomValues;
}

export class ArkWalletAdapter implements WalletAdapter {
    type = WalletType.ARKADE;
    private wallet: Wallet | null = null;
    private initialized = false;

    async initialize(mnemonic: string, config?: any): Promise<void> {
        if (this.initialized && this.wallet) return;

        try {
            console.log('Initializing Arkade Wallet...');

            // Arkade usually takes a private key. We derive one from the mnemonic.
            // NOTE: In a real implementation, we should use a specific derivation path (e.g. m/84'/0'/0'/0/0)
            // For now, we'll assume the mnemonic produces a master seed and we use that or a derived key.
            // Since `SingleKey.fromHex` is used in docs, we need a hex key.
            // We can use bip39 + bip32 (bitcoinjs-lib style) to derive, but for simplicity here I'll assume we have a utility.
            // For this PoC I'll simple use the seed directly if possible or mock the derivation if dependencies allow.
            // Actually we installed `bip39`.

            const seed = require('bip39').mnemonicToSeedSync(mnemonic);
            // Simple hash of seed to get 32 bytes for private key (NOT STANDARD, just for PoC if bip32 is tricky in RN without full crypto)
            // Ideally usage: bip32.fromSeed(seed).derivePath(...).privateKey

            // Let's rely on standard derivation if possible, but keeping it simple for now as I cannot easily import bip32 without specific 'tiny-secp256k1' etc in RN usually.
            // I'll use a sha256 or similar to get a key from seed for now.

            // For now, let's assume we use the first 32 bytes of the seed (it's 64).
            const privateKey = seed.slice(0, 32);
            const privateKeyHex = privateKey.toString('hex');

            const identity = SingleKey.fromHex(privateKeyHex);

            // Default to MutinyNet for testing as in docs, or configurable
            const arkServerUrl = config?.arkServerUrl || 'https://mutinynet.arkade.sh';
            const esploraUrl = config?.esploraUrl || 'https://mutinynet.com/api';

            this.wallet = await Wallet.create({
                identity,
                esploraUrl,
                arkProvider: new ExpoArkProvider(arkServerUrl),
                indexerProvider: new ExpoIndexerProvider(arkServerUrl),
                // storage: new AsyncStorageAdapter() // if we want persistence inside the SDK, but we might manage it externally
            });

            this.initialized = true;
            console.log('Arkade Wallet initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Arkade Wallet:', error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        // Arkade SDK disconnect usually just means stop event listening
        this.wallet = null;
        this.initialized = false;
    }

    async getBalance(): Promise<Balance> {
        if (!this.wallet) throw new Error('Arkade wallet not initialized');

        const balance = await this.wallet.getBalance();

        return {
            confirmed: balance.settled,
            unconfirmed: balance.preconfirmed,
            spendable: balance.spendable || balance.available,
            currency: 'SAT',
        };
    }

    async getTransactions(): Promise<Transaction[]> {
        if (!this.wallet) throw new Error('Arkade wallet not initialized');

        const history = await this.wallet.getTransactionHistory();
        return history.map((tx: any) => ({ // Type 'any' for now as SDK types might vary
            txid: tx.txid,
            amount: tx.amount, // check sign for send/receive
            timestamp: tx.timestamp || Date.now(),
            type: tx.amount > 0 ? 'receive' : 'send',
            status: tx.confirmed ? 'confirmed' : 'pending',
            fee: tx.fee,
        }));
    }

    async receive(amount?: number): Promise<string> {
        if (!this.wallet) throw new Error('Arkade wallet not initialized');

        // Arkade (Ark) usually receives via on-chain or boarding address?
        // Docs say: const arkAddress = await wallet.getAddress()
        return await this.wallet.getAddress();
    }

    async send(destination: string, amount: number): Promise<string> {
        if (!this.wallet) throw new Error('Arkade wallet not initialized');

        const txid = await this.wallet.sendBitcoin({
            address: destination,
            amount: amount,
            // feeRate: 1
        });

        return txid;
    }

    async sync(): Promise<void> {
        // Arkade SDK syncs via providers usually
        if (this.wallet) {
            await this.wallet.getBalance(); // Force refresh?
        }
    }
}
