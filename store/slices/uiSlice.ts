
// store/slices/uiSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface UIState {
  // Navigation state
  activeTab: string;
  previousScreen: string | null;
  
  // Modal states
  modals: {
    sendModal: boolean;
    receiveModal: boolean;
    settingsModal: boolean;
    assetDetailModal: boolean;
    qrScannerModal: boolean;
    confirmationModal: boolean;
    errorModal: boolean;
  };
  
  // Loading overlays
  overlays: {
    globalLoading: boolean;
    syncingOverlay: boolean;
    sendingOverlay: boolean;
    receivingOverlay: boolean;
  };
  
  // Toast notifications
  toast: {
    visible: boolean;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
    duration: number;
  };
  
  // Form states
  forms: {
    sendForm: {
      recipientAddress: string;
      amount: string;
      selectedAsset: string;
      feeRate: string;
      note: string;
    };
    receiveForm: {
      amount: string;
      selectedAsset: string;
      note: string;
    };
  };
  
  // Screen refresh states
  refreshing: {
    dashboard: boolean;
    assets: boolean;
    transactions: boolean;
  };
  
  // Search and filter states
  filters: {
    assetFilter: string;
    transactionFilter: 'all' | 'sent' | 'received' | 'pending';
    dateRange: {
      start: string | null;
      end: string | null;
    };
  };
  
  // Keyboard and input states
  keyboard: {
    isVisible: boolean;
    height: number;
  };
  
  // Theme and appearance
  appearance: {
    statusBarStyle: 'light' | 'dark';
    navigationBarHidden: boolean;
  };
}

const initialState: UIState = {
  activeTab: 'Dashboard',
  previousScreen: null,
  modals: {
    sendModal: false,
    receiveModal: false,
    settingsModal: false,
    assetDetailModal: false,
    qrScannerModal: false,
    confirmationModal: false,
    errorModal: false,
  },
  overlays: {
    globalLoading: false,
    syncingOverlay: false,
    sendingOverlay: false,
    receivingOverlay: false,
  },
  toast: {
    visible: false,
    message: '',
    type: 'info',
    duration: 3000,
  },
  forms: {
    sendForm: {
      recipientAddress: '',
      amount: '',
      selectedAsset: '',
      feeRate: '1',
      note: '',
    },
    receiveForm: {
      amount: '',
      selectedAsset: '',
      note: '',
    },
  },
  refreshing: {
    dashboard: false,
    assets: false,
    transactions: false,
  },
  filters: {
    assetFilter: '',
    transactionFilter: 'all',
    dateRange: {
      start: null,
      end: null,
    },
  },
  keyboard: {
    isVisible: false,
    height: 0,
  },
  appearance: {
    statusBarStyle: 'dark',
    navigationBarHidden: false,
  },
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    // Navigation
    setActiveTab: (state, action: PayloadAction<string>) => {
      state.previousScreen = state.activeTab;
      state.activeTab = action.payload;
    },
    setPreviousScreen: (state, action: PayloadAction<string | null>) => {
      state.previousScreen = action.payload;
    },
    
    // Modals
    openModal: (state, action: PayloadAction<keyof UIState['modals']>) => {
      state.modals[action.payload] = true;
    },
    closeModal: (state, action: PayloadAction<keyof UIState['modals']>) => {
      state.modals[action.payload] = false;
    },
    closeAllModals: (state) => {
      Object.keys(state.modals).forEach(key => {
        state.modals[key as keyof UIState['modals']] = false;
      });
    },
    
    // Overlays
    showOverlay: (state, action: PayloadAction<keyof UIState['overlays']>) => {
      state.overlays[action.payload] = true;
    },
    hideOverlay: (state, action: PayloadAction<keyof UIState['overlays']>) => {
      state.overlays[action.payload] = false;
    },
    hideAllOverlays: (state) => {
      Object.keys(state.overlays).forEach(key => {
        state.overlays[key as keyof UIState['overlays']] = false;
      });
    },
    
    // Toast notifications
    showToast: (state, action: PayloadAction<{
      message: string;
      type?: 'success' | 'error' | 'warning' | 'info';
      duration?: number;
    }>) => {
      state.toast = {
        visible: true,
        message: action.payload.message,
        type: action.payload.type || 'info',
        duration: action.payload.duration || 3000,
      };
    },
    hideToast: (state) => {
      state.toast.visible = false;
    },
    
    // Forms
    updateSendForm: (state, action: PayloadAction<Partial<UIState['forms']['sendForm']>>) => {
      state.forms.sendForm = { ...state.forms.sendForm, ...action.payload };
    },
    updateReceiveForm: (state, action: PayloadAction<Partial<UIState['forms']['receiveForm']>>) => {
      state.forms.receiveForm = { ...state.forms.receiveForm, ...action.payload };
    },
    resetSendForm: (state) => {
      state.forms.sendForm = initialState.forms.sendForm;
    },
    resetReceiveForm: (state) => {
      state.forms.receiveForm = initialState.forms.receiveForm;
    },
    resetAllForms: (state) => {
      state.forms = initialState.forms;
    },
    
    // Refresh states
    setRefreshing: (state, action: PayloadAction<{
      screen: keyof UIState['refreshing'];
      refreshing: boolean;
    }>) => {
      state.refreshing[action.payload.screen] = action.payload.refreshing;
    },
    
    // Filters
    setAssetFilter: (state, action: PayloadAction<string>) => {
      state.filters.assetFilter = action.payload;
    },
    setTransactionFilter: (state, action: PayloadAction<'all' | 'sent' | 'received' | 'pending'>) => {
      state.filters.transactionFilter = action.payload;
    },
    setDateRange: (state, action: PayloadAction<{ start: string | null; end: string | null }>) => {
      state.filters.dateRange = action.payload;
    },
    clearFilters: (state) => {
      state.filters = initialState.filters;
    },
    
    // Keyboard
    setKeyboardState: (state, action: PayloadAction<{ isVisible: boolean; height: number }>) => {
      state.keyboard = action.payload;
    },
    
    // Appearance
    setStatusBarStyle: (state, action: PayloadAction<'light' | 'dark'>) => {
      state.appearance.statusBarStyle = action.payload;
    },
    setNavigationBarHidden: (state, action: PayloadAction<boolean>) => {
      state.appearance.navigationBarHidden = action.payload;
    },
  },
});

export const {
  setActiveTab,
  setPreviousScreen,
  openModal,
  closeModal,
  closeAllModals,
  showOverlay,
  hideOverlay,
  hideAllOverlays,
  showToast,
  hideToast,
  updateSendForm,
  updateReceiveForm,
  resetSendForm,
  resetReceiveForm,
  resetAllForms,
  setRefreshing,
  setAssetFilter,
  setTransactionFilter,
  setDateRange,
  clearFilters,
  setKeyboardState,
  setStatusBarStyle,
  setNavigationBarHidden,
} = uiSlice.actions;

export default uiSlice.reducer;
