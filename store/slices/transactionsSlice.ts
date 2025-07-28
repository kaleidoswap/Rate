
// store/slices/transactionsSlice.ts
import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import { TransactionRecord } from '../../services/DatabaseService';
import DatabaseService from '../../services/DatabaseService';

interface TransactionsState {
  transactions: TransactionRecord[];
  isLoading: boolean;
  error: string | null;
}

const initialState: TransactionsState = {
  transactions: [],
  isLoading: false,
  error: null,
};

export const loadTransactions = createAsyncThunk(
  'transactions/load',
  async (walletId: number, { rejectWithValue }) => {
    try {
      const dbService = DatabaseService.getInstance();
      const transactions = await dbService.getTransactionsByWallet(walletId, 50);
      return transactions;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

const transactionsSlice = createSlice({
  name: 'transactions',
  initialState,
  reducers: {
    setTransactions: (state, action: PayloadAction<TransactionRecord[]>) => {
      state.transactions = action.payload;
    },
    addTransaction: (state, action: PayloadAction<TransactionRecord>) => {
      state.transactions.unshift(action.payload);
    },
    updateTransactionStatus: (state, action: PayloadAction<{
      txid: string;
      status: 'pending' | 'confirmed' | 'failed';
      blockHeight?: number;
    }>) => {
      const transaction = state.transactions.find(tx => tx.txid === action.payload.txid);
      if (transaction) {
        transaction.status = action.payload.status;
        if (action.payload.blockHeight) {
          transaction.block_height = action.payload.blockHeight;
        }
      }
    },
    clearTransactions: (state) => {
      state.transactions = [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadTransactions.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(loadTransactions.fulfilled, (state, action) => {
        state.isLoading = false;
        state.transactions = action.payload;
      })
      .addCase(loadTransactions.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });
  },
});

export const {
  setTransactions,
  addTransaction,
  updateTransactionStatus,
  clearTransactions,
} = transactionsSlice.actions;

export default transactionsSlice.reducer;
