import { WalletAdapter, WalletType, WalletManagerConfig } from './wallet/types';
import { SparkWalletAdapter } from './wallet/SparkWalletAdapter';
import { ArkWalletAdapter } from './wallet/ArkWalletAdapter';
import { LiquidWalletAdapter } from './wallet/LiquidWalletAdapter';
import DatabaseService from './DatabaseService';

export class WalletManager {
    private static instance: WalletManager;
    private adapters: Map<WalletType, WalletAdapter> = new Map();
    private activeMnemonic: string | null = null;
    private initialized = false;

    private constructor() {
        // Register adapters
        this.adapters.set(WalletType.SPARK, new SparkWalletAdapter());
        this.adapters.set(WalletType.ARKADE, new ArkWalletAdapter());
        this.adapters.set(WalletType.LIQUID, new LiquidWalletAdapter());
    }

    public static getInstance(): WalletManager {
        if (!WalletManager.instance) {
            WalletManager.instance = new WalletManager();
        }
        return WalletManager.instance;
    }

    /**
     * Initialize all enabled wallets with the master mnemonic
     */
    async initialize(mnemonic: string, networks: { type: WalletType; enabled: boolean; config?: any }[]): Promise<void> {
        this.activeMnemonic = mnemonic;

        const promises = networks
            .filter(n => n.enabled)
            .map(async (n) => {
                const adapter = this.adapters.get(n.type);
                if (adapter) {
                    try {
                        await adapter.initialize(mnemonic, n.config);
                    } catch (e) {
                        console.error(`Failed to initialize ${n.type} wallet:`, e);
                    }
                }
            });

        await Promise.all(promises);
        this.initialized = true;
    }

    getAdapter(type: WalletType): WalletAdapter | undefined {
        return this.adapters.get(type);
    }

    async getBalances(): Promise<Record<WalletType, any>> {
        const balances: Record<string, any> = {};

        for (const [type, adapter] of this.adapters.entries()) {
            try {
                // Only call if initialized (check adapter specific flag or catch error)
                // We really should expose isInitialized in adapter
                balances[type] = await adapter.getBalance();
            } catch (e) {
                // Ignore not initialized
                // console.warn(`Skipping balance for ${type} (not initialized)`);
            }
        }
        return balances;
    }

    async disconnectAll(): Promise<void> {
        const promises = Array.from(this.adapters.values()).map(a => a.disconnect());
        await Promise.all(promises);
        this.initialized = false;
        this.activeMnemonic = null;
    }
}

export default WalletManager;
