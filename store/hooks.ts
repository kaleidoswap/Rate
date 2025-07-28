

// store/hooks.ts
import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux';
import type { RootState, AppDispatch } from './index';

// Use throughout your app instead of plain `useDispatch` and `useSelector`
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

// Custom hooks for common selectors
export const useWallet = () => {
  return useAppSelector((state) => state.wallet);
};

export const useNode = () => {
  return useAppSelector((state) => state.node);
};

export const useSettings = () => {
  return useAppSelector((state) => state.settings);
};

export const useAssets = () => {
  return useAppSelector((state) => state.assets);
};

export const useTransactions = () => {
  return useAppSelector((state) => state.transactions);
};

export const useUI = () => {
  return useAppSelector((state) => state.ui);
};

// Computed selectors
export const useComputedSelectors = () => {
  const wallet = useWallet();
  const assets = useAssets();
  const settings = useSettings();

  return {
    // Total BTC balance in satoshis
    totalBtcBalance: wallet.btcBalance 
      ? wallet.btcBalance.vanilla.spendable + wallet.btcBalance.colored.spendable
      : 0,
    
    // Total BTC balance in USD
    totalBtcBalanceUSD: wallet.btcBalance && wallet.btcPriceUSD
      ? ((wallet.btcBalance.vanilla.spendable + wallet.btcBalance.colored.spendable) / 100000000) * wallet.btcPriceUSD
      : 0,
    
    // Total number of assets
    totalAssets: assets.rgbAssets.length,
    
    // Assets with balance > 0
    assetsWithBalance: assets.rgbAssets.filter(asset => asset.balance > 0),
    
    // Is wallet ready for use
    isWalletReady: wallet.isUnlocked && wallet.activeWallet && !wallet.isLoading,
    
    // Current network display name
    networkDisplayName: settings.network === 'regtest' ? 'Regtest' :
                       settings.network === 'testnet' ? 'Testnet' :
                       settings.network === 'signet' ? 'Signet' : 'Mainnet',
  };
};

// Async action creators for common operations
export const useWalletActions = () => {
  const dispatch = useAppDispatch();
  
  return {
    initializeWallet: (password: string, walletName: string) =>
      dispatch(initializeWallet({ password, walletName })),
    
    unlockWallet: (params: any) =>
      dispatch(unlockWallet(params)),
    
    loadBtcBalance: () =>
      dispatch(loadBtcBalance()),
    
    fetchBitcoinPrice: () =>
      dispatch(fetchBitcoinPrice()),
    
    syncWallet: () =>
      dispatch(syncWallet()),
  };
};

export const useNodeActions = () => {
  const dispatch = useAppDispatch();
  
  return {
    startNode: () => dispatch(startNode()),
    stopNode: () => dispatch(stopNode()),
    loadNodeInfo: () => dispatch(loadNodeInfo()),
    performHealthCheck: () => dispatch(performHealthCheck()),
  };
};

export const useAssetActions = () => {
  const dispatch = useAppDispatch();
  
  return {
    loadAssets: (walletId: number) => dispatch(loadAssets(walletId)),
    syncAssets: (walletId: number) => dispatch(syncAssets(walletId)),
    issueNiaAsset: (params: any) => dispatch(issueNiaAsset(params)),
  };
};

// Import async thunks
import { 
  initializeWallet, 
  unlockWallet, 
  loadBtcBalance, 
  fetchBitcoinPrice, 
  syncWallet 
} from './slices/walletSlice';

import { 
  startNode, 
  stopNode, 
  loadNodeInfo, 
  performHealthCheck 
} from './slices/nodeSlice';

import { 
  loadAssets, 
  syncAssets, 
  issueNiaAsset 
} from './slices/assetsSlice';

import { loadTransactions } from './slices/transactionsSlice';