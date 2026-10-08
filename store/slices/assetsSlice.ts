// store/slices/assetsSlice.ts
import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import { AssetRecord } from '../../services/DatabaseService';
import { protocolManager, rgbAccountAdapter } from '../../services/protocols';
import DatabaseService from '../../services/DatabaseService';
import { assetRecordFromUnified, replaceProtocolAssets, type InventoryRecord, type TokenProtocol } from '../../utils/asset-inventory';

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
  /**
   * Every account's assets (RGB, Spark, Arkade), not just RGB: the source the
   * asset inventory (utils/asset-inventory.ts) reads. Written by the dashboard's
   * refresh and by syncAssets, always as live data.
   */
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
  { byProtocol: Partial<Record<TokenProtocol, InventoryRecord[]>>; syncTime: number },
  number
>(
  'assets/sync',
  async (walletId: number) => {
    const dbService = DatabaseService.getInstance();

    // The same accounts, and the same record shape, as the dashboard's refresh.
    const accounts: Array<[TokenProtocol, any]> = [
      ['RGB', rgbAccountAdapter()],
      ['SPARK', protocolManager.getAdapterIfAvailable('SPARK')],
      ['ARKADE', protocolManager.getAdapterIfAvailable('ARKADE')],
    ];
    const byProtocol: Partial<Record<TokenProtocol, InventoryRecord[]>> = {};
    for (const [proto, adapter] of accounts) {
      if (!adapter?.isConnected()) continue;
      try {
        // Reconcile with the network first so pending/unclaimed transfers
        // settle before we read balances. On Spark this runs
        // experimental_syncWallet(), which is what surfaces tokens (e.g. USDB
        // just received from a Flashnet swap) that getBalance() would
        // otherwise report as still-incoming. Best-effort: never block listing.
        try { await adapter.refreshBalances?.(); } catch { /* non-fatal */ }
        const listed = await adapter.listAssets();
        byProtocol[proto] = listed
          .map((a: any) => assetRecordFromUnified(a, proto, walletId))
          .filter((r: InventoryRecord | null): r is InventoryRecord => r !== null);
      } catch { /* an account that fails keeps what it showed */ }
    }

    for (const records of Object.values(byProtocol)) {
      for (const asset of records ?? []) {
        await dbService.upsertAsset({
          wallet_id: walletId,
          asset_id: asset.asset_id,
          ticker: asset.ticker,
          name: asset.name,
          precision: asset.precision,
          issued_supply: asset.issued_supply ?? 0,
          balance: Number(asset.balance) || 0,
          last_updated: Date.now(),
        });
      }
    }

    return { byProtocol, syncTime: Date.now() };
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
    const dbService = DatabaseService.getInstance();

    // Issue asset via protocolManager
    const rgbAdapter = rgbAccountAdapter() as any;
    if (!rgbAdapter?.isConnected()) {
      throw new Error('RGB protocol not connected');
    }
    let result: { asset: any };
    if (typeof rgbAdapter.issueAssetNia === 'function') {
      // RGB on this phone returns a unified asset; shape it like the node's answer.
      const issued = await rgbAdapter.issueAssetNia({
        amounts: params.amounts, ticker: params.ticker, name: params.name, precision: params.precision,
      });
      const supply = params.amounts.reduce((sum, n) => sum + n, 0);
      result = { asset: {
        asset_id: issued.id, ticker: issued.ticker, name: issued.name, precision: issued.precision,
        issued_supply: supply, balance: { settled: Number(issued.balance?.total ?? supply) },
      } };
    } else {
      if (!rgbAdapter.executeProtocolOperation) throw new Error('RGB protocol not connected');
      // executeProtocolOperation returns `unknown` (beta.55); narrow to the shape we use.
      result = (await rgbAdapter.executeProtocolOperation('issueAssetNIA', {
        amounts: params.amounts,
        ticker: params.ticker,
        name: params.name,
        precision: params.precision,
      })) as { asset: any };
    }

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
    /** One account's fresh assets replace the ones it listed before. */
    setProtocolAssets: (state, action: PayloadAction<{ protocol: TokenProtocol; assets: InventoryRecord[] }>) => {
      state.rgbAssets = replaceProtocolAssets(
        state.rgbAssets as InventoryRecord[], action.payload.protocol, action.payload.assets,
      ) as AssetRecord[];
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
        let next = state.rgbAssets as InventoryRecord[];
        for (const [protocol, records] of Object.entries(action.payload.byProtocol)) {
          next = replaceProtocolAssets(next, protocol as TokenProtocol, records ?? []);
        }
        state.rgbAssets = next as AssetRecord[];
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
  setProtocolAssets,
  addRgbAsset,
  updateAssetBalance,
  clearError,
} = assetsSlice.actions;

export default assetsSlice.reducer;
