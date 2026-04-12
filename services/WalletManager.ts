/**
 * WalletManager — DEPRECATED
 * Thin facade over ProtocolManager for backward compatibility.
 * New code should use protocolManager from './protocols' directly.
 */
import { protocolManager, initializeProtocols } from './protocols';

export enum WalletType {
    SPARK = 'spark',
    LIQUID = 'liquid',
    ARKADE = 'arkade',
}

export class WalletManager {
    private static instance: WalletManager;
    private initialized = false;

    private constructor() {}

    public static getInstance(): WalletManager {
        if (!WalletManager.instance) {
            WalletManager.instance = new WalletManager();
        }
        return WalletManager.instance;
    }

    /** @deprecated Use initializeProtocols() from './protocols' */
    async initialize(mnemonic: string, networks: { type: WalletType; enabled: boolean; config?: any }[]): Promise<void> {
        const networkConfigs = networks.map(n => ({
            type: n.type,
            enabled: n.enabled,
            config: n.config ? JSON.stringify(n.config) : undefined,
        }));

        await initializeProtocols(mnemonic, networkConfigs);
        this.initialized = true;
    }

    /** @deprecated Use protocolManager.getAdapter() */
    getAdapter(type: WalletType): any {
        const protocolMap: Record<string, string> = {
            spark: 'SPARK',
            arkade: 'ARKADE',
            liquid: 'RGB', // No liquid adapter, fallback to RGB
        };
        try {
            return protocolManager.getAdapter(protocolMap[type] as any);
        } catch {
            return undefined;
        }
    }

    /** @deprecated Use protocolManager.disconnectAll() */
    async disconnectAll(): Promise<void> {
        await protocolManager.disconnectAll();
        this.initialized = false;
    }
}

export default WalletManager;
