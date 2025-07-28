// store/slices/swapSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface SwapQuote {
  rfq_id: string;
  from_asset: string;
  to_asset: string;
  from_amount: number;
  to_amount: number;
  fee_amount: number;
  exchange_rate: number;
  expiry_timestamp: number;
  maker_pubkey: string;
}

export interface SwapExecution {
  rfq_id: string;
  swap_string: string;
  status: 'pending' | 'whitelisted' | 'executing' | 'completed' | 'failed';
  created_at: number;
  updated_at: number;
  txid?: string;
  error_message?: string;
}

interface SwapState {
  // Current swap flow
  currentQuote: SwapQuote | null;
  currentExecution: SwapExecution | null;
  isQuoteLoading: boolean;
  isExecuting: boolean;
  
  // Swap history
  swapHistory: SwapExecution[];
  
  // Form state
  fromAsset: string;
  toAsset: string;
  fromAmount: string;
  toAmount: string;
  
  // Available assets for swapping
  availableAssets: string[];
  
  // Error handling
  error: string | null;
  
  // UI state
  step: 'select' | 'quote' | 'confirm' | 'executing' | 'completed';
  showQuoteModal: boolean;
  showConfirmModal: boolean;
}

const initialState: SwapState = {
  currentQuote: null,
  currentExecution: null,
  isQuoteLoading: false,
  isExecuting: false,
  swapHistory: [],
  fromAsset: '',
  toAsset: '',
  fromAmount: '',
  toAmount: '',
  availableAssets: [],
  error: null,
  step: 'select',
  showQuoteModal: false,
  showConfirmModal: false,
};

const swapSlice = createSlice({
  name: 'swap',
  initialState,
  reducers: {
    // Form actions
    setFromAsset: (state, action: PayloadAction<string>) => {
      state.fromAsset = action.payload;
    },
    setToAsset: (state, action: PayloadAction<string>) => {
      state.toAsset = action.payload;
    },
    setFromAmount: (state, action: PayloadAction<string>) => {
      state.fromAmount = action.payload;
    },
    setToAmount: (state, action: PayloadAction<string>) => {
      state.toAmount = action.payload;
    },
    swapAssets: (state) => {
      const tempAsset = state.fromAsset;
      const tempAmount = state.fromAmount;
      state.fromAsset = state.toAsset;
      state.fromAmount = state.toAmount;
      state.toAsset = tempAsset;
      state.toAmount = tempAmount;
    },
    
    // Quote actions
    setQuoteLoading: (state, action: PayloadAction<boolean>) => {
      state.isQuoteLoading = action.payload;
    },
    setCurrentQuote: (state, action: PayloadAction<SwapQuote | null>) => {
      state.currentQuote = action.payload;
      if (action.payload) {
        state.toAmount = action.payload.to_amount.toString();
        state.step = 'quote';
      }
    },
    
    // Execution actions
    setExecuting: (state, action: PayloadAction<boolean>) => {
      state.isExecuting = action.payload;
    },
    setCurrentExecution: (state, action: PayloadAction<SwapExecution | null>) => {
      state.currentExecution = action.payload;
      if (action.payload) {
        state.step = 'executing';
      }
    },
    updateExecutionStatus: (state, action: PayloadAction<{
      rfq_id: string;
      status: SwapExecution['status'];
      txid?: string;
      error_message?: string;
    }>) => {
      if (state.currentExecution?.rfq_id === action.payload.rfq_id) {
        state.currentExecution.status = action.payload.status;
        state.currentExecution.updated_at = Date.now();
        if (action.payload.txid) {
          state.currentExecution.txid = action.payload.txid;
        }
        if (action.payload.error_message) {
          state.currentExecution.error_message = action.payload.error_message;
        }
        
        if (action.payload.status === 'completed') {
          state.step = 'completed';
        } else if (action.payload.status === 'failed') {
          state.error = action.payload.error_message || 'Swap failed';
        }
      }
    },
    
    // History actions
    addToHistory: (state, action: PayloadAction<SwapExecution>) => {
      state.swapHistory.unshift(action.payload);
      // Keep only last 50 swaps
      if (state.swapHistory.length > 50) {
        state.swapHistory = state.swapHistory.slice(0, 50);
      }
    },
    
    // Available assets
    setAvailableAssets: (state, action: PayloadAction<string[]>) => {
      state.availableAssets = action.payload;
    },
    
    // Step navigation
    setStep: (state, action: PayloadAction<SwapState['step']>) => {
      state.step = action.payload;
    },
    nextStep: (state) => {
      switch (state.step) {
        case 'select':
          state.step = 'quote';
          break;
        case 'quote':
          state.step = 'confirm';
          break;
        case 'confirm':
          state.step = 'executing';
          break;
        case 'executing':
          state.step = 'completed';
          break;
      }
    },
    
    // Modal actions
    setShowQuoteModal: (state, action: PayloadAction<boolean>) => {
      state.showQuoteModal = action.payload;
    },
    setShowConfirmModal: (state, action: PayloadAction<boolean>) => {
      state.showConfirmModal = action.payload;
    },
    
    // Error handling
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
    
    // Reset actions
    resetSwap: (state) => {
      state.currentQuote = null;
      state.currentExecution = null;
      state.fromAmount = '';
      state.toAmount = '';
      state.step = 'select';
      state.error = null;
      state.showQuoteModal = false;
      state.showConfirmModal = false;
    },
    resetForm: (state) => {
      state.fromAsset = '';
      state.toAsset = '';
      state.fromAmount = '';
      state.toAmount = '';
      state.currentQuote = null;
      state.step = 'select';
      state.error = null;
    },
  },
});

export const {
  setFromAsset,
  setToAsset,
  setFromAmount,
  setToAmount,
  swapAssets,
  setQuoteLoading,
  setCurrentQuote,
  setExecuting,
  setCurrentExecution,
  updateExecutionStatus,
  addToHistory,
  setAvailableAssets,
  setStep,
  nextStep,
  setShowQuoteModal,
  setShowConfirmModal,
  setError,
  clearError,
  resetSwap,
  resetForm,
} = swapSlice.actions;

export default swapSlice.reducer; 