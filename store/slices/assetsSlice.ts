// store/slices/assetsSlice.ts
import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import { AssetRecord } from '../../services/DatabaseService';
import RGBApiService from '../../services/RGBApiService';
import DatabaseService from '../../services/DatabaseService';

// Define NiaAsset interface locally since it's not exported from RGBApiService
interface NiaAsset {
  asset_id: string;
  asset_iface: string;
  ticker: string;
  name: string;
  details: string | null;
  precision: number;
  issued_supply: number;
  timestamp: number;
  added_at: number;
  balance: {
    settled: number;
    future: number;
    spendable: number;
    offchain_outbound?: number;
    offchain_inbound?: number;
  };
  media: string | null;
}

interface AssetsState {
  // Assets data
  rgbAssets: AssetRecord[];
  
  // Loading states
  isLoading: boolean;
  isIssuing: boolean;
  isSending: boolean;
  
  // Error states
  error: string | null;
  
  // Last sync
  lastSyncTime: number | null;
}

const initialState: AssetsState = {
  rgbAssets: [],
  isLoading: false,
  isIssuing: false,
  isSending: false,
  error: null,
  lastSyncTime: null,
};

// Async thunks
export const loadAssets = createAsyncThunk<AssetRecord[], number>(
  'assets/load',
  async (walletId: number) => {
    const dbService = DatabaseService.getInstance();
    const assets = await dbService.getAssetsByWallet(walletId);
    return assets;
  }
);

export const syncAssets = createAsyncThunk<
  { assets: AssetRecord[]; syncTime: number },
  number
>(
  'assets/sync',
  async (walletId: number) => {
    const apiService = RGBApiService.getInstance();
    const dbService = DatabaseService.getInstance();
    
    // Get assets from RGB node
    const assetsResponse = await apiService.listAssets();
    
    // Update database with latest asset info
    for (const asset of assetsResponse.nia) {
      await dbService.upsertAsset({
        wallet_id: walletId,
        asset_id: asset.asset_id,
        ticker: asset.ticker,
        name: asset.name,
        precision: asset.precision,
        issued_supply: asset.issued_supply,
        balance: asset.balance.settled,
        last_updated: Date.now(),
      });
    }
    
    // Get updated assets from database
    const updatedAssets = await dbService.getAssetsByWallet(walletId);
    return { assets: updatedAssets, syncTime: Date.now() };
  }
);

export const issueNiaAsset = createAsyncThunk<
  NiaAsset,
  {
    amounts: number[];
    ticker: string;
    name: string;
    precision: number;
    walletId: number;
  }
>(
  'assets/issueNia',
  async (params) => {
    const apiService = RGBApiService.getInstance();
    const dbService = DatabaseService.getInstance();
    
    // Issue asset via API
    const result = await apiService.issueNiaAsset(
      params.amounts,
      params.ticker,
      params.name,
      params.precision
    );
    
    // Add to database
    await dbService.upsertAsset({
      wallet_id: params.walletId,
      asset_id: result.asset.asset_id,
      ticker: result.asset.ticker,
      name: result.asset.name,
      precision: result.asset.precision,
      issued_supply: result.asset.issued_supply,
      balance: result.asset.balance.settled,
      last_updated: Date.now(),
    });
    
    return result.asset;
  }
);

const assetsSlice = createSlice({
  name: 'assets',
  initialState,
  reducers: {
    setRgbAssets: (state, action: PayloadAction<AssetRecord[]>) => {
      state.rgbAssets = action.payload;
    },
    addRgbAsset: (state, action: PayloadAction<AssetRecord>) => {
      const existingIndex = state.rgbAssets.findIndex(
        asset => asset.asset_id === action.payload.asset_id
      );
      if (existingIndex >= 0) {
        state.rgbAssets[existingIndex] = action.payload;
      } else {
        state.rgbAssets.push(action.payload);
      }
    },
    updateAssetBalance: (state, action: PayloadAction<{ assetId: string; balance: number }>) => {
      const asset = state.rgbAssets.find(a => a.asset_id === action.payload.assetId);
      if (asset) {
        asset.balance = action.payload.balance;
        asset.last_updated = Date.now();
      }
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    // Load assets
    builder
      .addCase(loadAssets.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(loadAssets.fulfilled, (state, action) => {
        state.isLoading = false;
        state.rgbAssets = action.payload;
      })
      .addCase(loadAssets.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to load assets';
      });

    // Sync assets
    builder
      .addCase(syncAssets.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(syncAssets.fulfilled, (state, action) => {
        state.isLoading = false;
        state.rgbAssets = action.payload.assets;
        state.lastSyncTime = action.payload.syncTime;
      })
      .addCase(syncAssets.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to sync assets';
      });

    // Issue NIA asset
    builder
      .addCase(issueNiaAsset.pending, (state) => {
        state.isIssuing = true;
        state.error = null;
      })
      .addCase(issueNiaAsset.fulfilled, (state) => {
        state.isIssuing = false;
      })
      .addCase(issueNiaAsset.rejected, (state, action) => {
        state.isIssuing = false;
        state.error = action.error.message || 'Failed to issue asset';
      });
  },
});

export const {
  setRgbAssets,
  addRgbAsset,
  updateAssetBalance,
  clearError,
} = assetsSlice.actions;

export default assetsSlice.reducer;
