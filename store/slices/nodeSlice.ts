// store/slices/nodeSlice.ts
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { RGBNodeService } from '../../services/RGBNodeService';

interface NodeState {
  status: {
    isRunning: boolean;
    port: number;
    lightningPort: number;
    error?: string;
  };
  isStarting: boolean;
  isStopping: boolean;
  networkInfo: any | null;
  nodeInfo: any | null;
  lastHealthCheck: Date | null;
  healthCheckInterval: NodeJS.Timeout | null;
  consecutiveFailures: number;
  error: string | null;
  startupError: string | null;
}

const initialState: NodeState = {
  status: {
    isRunning: false,
    port: 3008,
    lightningPort: 9738,
  },
  isStarting: false,
  isStopping: false,
  networkInfo: null,
  nodeInfo: null,
  lastHealthCheck: null,
  healthCheckInterval: null,
  consecutiveFailures: 0,
  error: null,
  startupError: null,
};

// Async thunks
export const startNode = createAsyncThunk(
  'node/start',
  async (_, { rejectWithValue }) => {
    try {
      const nodeService = RGBNodeService.getInstance();
      
      // Initialize binary if needed
      const initialized = await nodeService.initializeNode();
      if (!initialized) {
        throw new Error('Failed to initialize RGB node binary');
      }
      
      // Get node status (remote node is always "running" after init)
      const status = nodeService.getNodeStatus();
      if (!status.isRunning) {
        throw new Error('Failed to start RGB node');
      }
      
      return {
        isRunning: status.isRunning,
        port: status.daemonPort,
        lightningPort: 9738,
      };
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const stopNode = createAsyncThunk(
  'node/stop',
  async (_, { rejectWithValue }) => {
    try {
      const nodeService = RGBNodeService.getInstance();
      // For remote nodes, we just update the status
      nodeService.setNodeStatus({ isRunning: false });
      return true;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

const nodeSlice = createSlice({
  name: 'node',
  initialState,
  reducers: {
    setNodeStatus(state, action) {
      state.status = action.payload;
    },
    setError(state, action) {
      state.error = action.payload;
    },
    clearError(state) {
      state.error = null;
    },
    updateHealthCheck(state, action) {
      state.lastHealthCheck = action.payload;
      state.consecutiveFailures = 0;
    },
    incrementFailures(state) {
      state.consecutiveFailures += 1;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(startNode.pending, (state) => {
        state.isStarting = true;
        state.startupError = null;
      })
      .addCase(startNode.fulfilled, (state, action) => {
        state.isStarting = false;
        state.status = action.payload;
      })
      .addCase(startNode.rejected, (state, action) => {
        state.isStarting = false;
        state.startupError = action.payload as string;
      })
      .addCase(stopNode.pending, (state) => {
        state.isStopping = true;
      })
      .addCase(stopNode.fulfilled, (state) => {
        state.isStopping = false;
        state.status.isRunning = false;
      })
      .addCase(stopNode.rejected, (state, action) => {
        state.isStopping = false;
        state.error = action.payload as string;
      });
  },
});

export const {
  setNodeStatus,
  setError,
  clearError,
  updateHealthCheck,
  incrementFailures,
} = nodeSlice.actions;

export default nodeSlice.reducer;
