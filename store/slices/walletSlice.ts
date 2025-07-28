// store/slices/walletSlice.ts
import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import { WalletRecord } from '../../services/DatabaseService';
import RGBApiService from '../../services/RGBApiService';
import DatabaseService from '../../services/DatabaseService';

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
  async (params: { password: string; walletName: string }, { rejectWithValue }) => {
    try {
      const apiService = RGBApiService.getInstance();
      const dbService = DatabaseService.getInstance();
      
      // Initialize wallet via API
      const initResponse = await apiService.initializeNode(params.password);
      
      // Create wallet record in database
      const walletId = await dbService.createWallet({
        name: params.walletName,
        network: 'regtest',
        created_at: Date.now(),
        is_active: true,
        encrypted_mnemonic: initResponse.mnemonic, // This should be encrypted
      });
      
      const wallet = await dbService.getActiveWallet();
      return { wallet, mnemonic: initResponse.mnemonic };
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
      await apiService.syncWallet();
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
      })
      .addCase(initializeWallet.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
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
