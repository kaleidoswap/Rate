// store/slices/walletSlice.ts
import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import { WalletRecord, NetworkConfig, NetworkType } from '../../services/DatabaseService';
import RGBApiService from '../../services/RGBApiService';
import DatabaseService from '../../services/DatabaseService';
import { RGBNodeService } from '../../services/RGBNodeService';

export interface BtcBalance {
  vanilla: {
    settled: number;
    future: number;
    spendable: number;
  };
  colored: {
    settled: number;
    future: number;
    spendable: number;
  };
}

interface WalletState {
  // Wallet info
  activeWallet: WalletRecord | null;
  wallets: WalletRecord[];
  isUnlocked: boolean;
  isInitialized: boolean;

  // Balances
  btcBalance: BtcBalance | null;
  btcPriceUSD: number;

  // Loading states
  isLoading: boolean;
  isBalanceLoading: boolean;
  isSyncing: boolean;

  // Error states
  error: string | null;
  lastSyncTime: number | null;
}

const initialState: WalletState = {
  activeWallet: null,
  wallets: [],
  isUnlocked: false,
  isInitialized: false,
  btcBalance: null,
  btcPriceUSD: 0,
  isLoading: false,
  isBalanceLoading: false,
  isSyncing: false,
  error: null,
  lastSyncTime: null,
};

// Async thunks
export const initializeWallet = createAsyncThunk(
  'wallet/initialize',
  async (params: { password: string; walletName: string; networks: Omit<NetworkConfig, 'id' | 'wallet_id'>[] }, { rejectWithValue }) => {
    try {
      const dbService = DatabaseService.getInstance();
      const walletManager = require('../../services/WalletManager').default.getInstance();

      // Retrieve wallet from DB (assuming active or by name/id logic needed here, but keeping simple)
      const wallet = await dbService.getActiveWallet();
      if (!wallet || !wallet.encrypted_mnemonic) {
        throw new Error('No active wallet or missing mnemonic');
      }

      // Decrypt mnemonic (mocking decryption for now as per previous logic, usually handled by DB service in future)
      // Assuming encrypted_mnemonic IS the mnemonic for this PoC if encryption not fully wired in DB service layer yet
      // OR assuming DatabaseService handles it.
      const mnemonic = wallet.encrypted_mnemonic;

      // Initialize WalletManager
      const walletNetworks = params.networks.map(n => ({
        type: n.type as any, // Cast to WalletType
        enabled: n.enabled,
        config: n.config ? JSON.parse(n.config) : {},
      }));

      await walletManager.initialize(mnemonic, walletNetworks);

      return { wallet, mnemonic };
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const loadWallets = createAsyncThunk(
  'wallet/loadWallets',
  async (_, { rejectWithValue }) => {
    try {
      const dbService = DatabaseService.getInstance();
      const wallets = await dbService.getAllWallets();
      const activeWallet = await dbService.getActiveWallet();
      return { wallets, activeWallet };
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const switchWallet = createAsyncThunk(
  'wallet/switch',
  async (walletId: number, { rejectWithValue }) => {
    try {
      const dbService = DatabaseService.getInstance();
      await dbService.setActiveWallet(walletId);
      const wallet = await dbService.getActiveWallet();
      const walletManager = require('../../services/WalletManager').default.getInstance();

      if (wallet && wallet.encrypted_mnemonic) {
        // Disconnect old
        await walletManager.disconnectAll();

        // Re-init new
        const walletNetworks = wallet.networks?.map(n => ({
          type: n.type as any,
          enabled: n.enabled,
          config: n.config ? JSON.parse(n.config) : {},
        })) || [];

        await walletManager.initialize(wallet.encrypted_mnemonic, walletNetworks);
      }

      return wallet;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const createNewWallet = createAsyncThunk(
  'wallet/create',
  async (params: { name: string; mnemonic: string; networks: Omit<NetworkConfig, 'id' | 'wallet_id'>[] }, { rejectWithValue }) => {
    try {
      const dbService = DatabaseService.getInstance();
      const walletManager = require('../../services/WalletManager').default.getInstance();

      // Create wallet record
      const walletId = await dbService.createWallet({
        name: params.name,
        created_at: Date.now(),
        is_active: true,
        encrypted_mnemonic: params.mnemonic, // Should be encrypted in real app using PIN
      }, params.networks);

      // Fetch the newly created wallet
      const wallet = await dbService.getWallet(walletId);

      if (wallet) {
        // Initialize WalletManager
        const walletNetworks = params.networks.map(n => ({
          type: n.type as any,
          enabled: n.enabled,
          config: n.config ? JSON.parse(n.config) : {},
        }));

        await walletManager.initialize(params.mnemonic, walletNetworks);
      }

      return wallet;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const deleteWallet = createAsyncThunk(
  'wallet/delete',
  async (walletId: number, { rejectWithValue }) => {
    try {
      const dbService = DatabaseService.getInstance();
      await dbService.deleteWallet(walletId);
      return walletId;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const updateNetwork = createAsyncThunk(
  'wallet/updateNetwork',
  async (params: { walletId: number; type: NetworkType; config: Partial<NetworkConfig> }, { rejectWithValue, getState }) => {
    try {
      const dbService = DatabaseService.getInstance();
      await dbService.updateNetworkConfig(params.walletId, params.type, params.config);
      const wallet = await dbService.getActiveWallet(); // Refresh active wallet to get updated networks

      // Check if we updated the active wallet's RLN config
      const state = getState() as any; // Need RootState type but avoiding circular dep
      const activeWalletId = state.wallet?.activeWallet?.id;

      if (wallet && wallet.id === activeWalletId && params.type === 'rln') {
        const rlnConfig = wallet.networks?.find(n => n.type === 'rln' && n.enabled);
        if (rlnConfig && rlnConfig.config) {
          try {
            const config = JSON.parse(rlnConfig.config);
            let apiUrl = '';
            if (config.type === 'remote' && config.url) {
              apiUrl = config.url;
            } else if (config.type === 'local') {
              apiUrl = 'http://127.0.0.1:3000';
            }

            if (apiUrl) {
              const apiService = RGBApiService.getInstance();
              apiService.initialize({
                baseURL: apiUrl,
                timeout: 30000,
              });
            }
          } catch (e) {
            console.error('Failed to re-init API on network update:', e);
          }
        }
      }

      return wallet;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const unlockWallet = createAsyncThunk(
  'wallet/unlock',
  async (params: {
    password: string;
    bitcoindConfig: any;
    indexerUrl: string;
    proxyEndpoint: string;
  }, { rejectWithValue }) => {
    try {
      const apiService = RGBApiService.getInstance();
      const dbService = DatabaseService.getInstance();

      // Unlock wallet via API
      await apiService.unlockNode({
        password: params.password,
        bitcoind_rpc_username: params.bitcoindConfig.username,
        bitcoind_rpc_password: params.bitcoindConfig.password,
        bitcoind_rpc_host: params.bitcoindConfig.host,
        bitcoind_rpc_port: params.bitcoindConfig.port,
        indexer_url: params.indexerUrl,
        proxy_endpoint: params.proxyEndpoint,
      });

      const wallet = await dbService.getActiveWallet();
      return wallet;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const loadBtcBalance = createAsyncThunk(
  'wallet/loadBtcBalance',
  async (_, { rejectWithValue }) => {
    try {
      const apiService = RGBApiService.getInstance();
      const balance = await apiService.getBtcBalance();
      return balance;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const fetchBitcoinPrice = createAsyncThunk(
  'wallet/fetchBitcoinPrice',
  async (_, { rejectWithValue }) => {
    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
      );
      const data = await response.json();
      return data.bitcoin.usd;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const syncWallet = createAsyncThunk(
  'wallet/sync',
  async (_, { rejectWithValue }) => {
    try {
      const apiService = RGBApiService.getInstance();
      await apiService.sync();
      return Date.now();
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

const walletSlice = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    setActiveWallet: (state, action: PayloadAction<WalletRecord>) => {
      state.activeWallet = action.payload;
    },
    setWallets: (state, action: PayloadAction<WalletRecord[]>) => {
      state.wallets = action.payload;
    },
    setUnlocked: (state, action: PayloadAction<boolean>) => {
      state.isUnlocked = action.payload;
    },
    setInitialized: (state, action: PayloadAction<boolean>) => {
      state.isInitialized = action.payload;
    },
    setBtcBalance: (state, action: PayloadAction<BtcBalance>) => {
      state.btcBalance = action.payload;
    },
    setBtcPriceUSD: (state, action: PayloadAction<number>) => {
      state.btcPriceUSD = action.payload;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setBalanceLoading: (state, action: PayloadAction<boolean>) => {
      state.isBalanceLoading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
    resetWallet: () => initialState,
  },
  extraReducers: (builder) => {
    // Initialize wallet
    builder
      .addCase(initializeWallet.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(initializeWallet.fulfilled, (state, action) => {
        state.isLoading = false;
        state.activeWallet = action.payload.wallet;
        state.isInitialized = true;
        state.isUnlocked = true;
        if (action.payload.wallet) {
          state.wallets = [...state.wallets, action.payload.wallet];
        }
      })
      .addCase(initializeWallet.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });

    // Load wallets
    builder
      .addCase(loadWallets.fulfilled, (state, action) => {
        state.wallets = action.payload.wallets;
        state.activeWallet = action.payload.activeWallet;
        if (action.payload.activeWallet) {
          state.isInitialized = true;
        }
      });

    // Switch wallet
    builder
      .addCase(switchWallet.fulfilled, (state, action) => {
        state.activeWallet = action.payload;
      });

    // Create new wallet
    builder
      .addCase(createNewWallet.fulfilled, (state, action) => {
        state.activeWallet = action.payload;
        if (action.payload) {
          state.wallets = [action.payload, ...state.wallets];
        }
      });

    // Delete wallet
    builder
      .addCase(deleteWallet.fulfilled, (state, action) => {
        state.wallets = state.wallets.filter(w => w.id !== action.payload);
        if (state.activeWallet?.id === action.payload) {
          state.activeWallet = state.wallets[0] || null;
        }
      });

    // Update network
    builder
      .addCase(updateNetwork.fulfilled, (state, action) => {
        if (state.activeWallet && state.activeWallet.id === action.payload?.id) {
          state.activeWallet = action.payload;
        }
        // Update in list as well
        const index = state.wallets.findIndex(w => w.id === action.payload?.id);
        if (index !== -1 && action.payload) {
          state.wallets[index] = action.payload;
        }
      });

    // Unlock wallet
    builder
      .addCase(unlockWallet.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(unlockWallet.fulfilled, (state, action) => {
        state.isLoading = false;
        state.activeWallet = action.payload;
        state.isUnlocked = true;
      })
      .addCase(unlockWallet.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });

    // Load BTC balance
    builder
      .addCase(loadBtcBalance.pending, (state) => {
        state.isBalanceLoading = true;
      })
      .addCase(loadBtcBalance.fulfilled, (state, action) => {
        state.isBalanceLoading = false;
        state.btcBalance = action.payload;
      })
      .addCase(loadBtcBalance.rejected, (state, action) => {
        state.isBalanceLoading = false;
        state.error = action.payload as string;
      });

    // Fetch Bitcoin price
    builder
      .addCase(fetchBitcoinPrice.fulfilled, (state, action) => {
        state.btcPriceUSD = action.payload;
      });

    // Sync wallet
    builder
      .addCase(syncWallet.pending, (state) => {
        state.isSyncing = true;
      })
      .addCase(syncWallet.fulfilled, (state, action) => {
        state.isSyncing = false;
        state.lastSyncTime = action.payload;
      })
      .addCase(syncWallet.rejected, (state, action) => {
        state.isSyncing = false;
        state.error = action.payload as string;
      });
  },
});

export const {
  setActiveWallet,
  setWallets,
  setUnlocked,
  setInitialized,
  setBtcBalance,
  setBtcPriceUSD,
  setLoading,
  setBalanceLoading,
  setError,
  clearError,
  resetWallet,
} = walletSlice.actions;

export default walletSlice.reducer;
