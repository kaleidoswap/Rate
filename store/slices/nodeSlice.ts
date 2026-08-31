import { toEngineProtocol } from '../../utils/protocol-bridge'
// store/slices/nodeSlice.ts
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { protocolManager } from '../../services/protocols';

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

export const startNode = createAsyncThunk(
  'node/start',
  async (_, { rejectWithValue }) => {
    try {
      // Check if any protocol is connected
      const rgbAdapter = protocolManager.getAdapterIfAvailable('RGB_LN');
      if (rgbAdapter?.isConnected()) {
        return { isRunning: true, port: 3008, lightningPort: 9738 };
      }

      // Try to get connection info from any adapter
      const protocols: Array<'RGB' | 'SPARK' | 'ARKADE'> = ['RGB', 'SPARK', 'ARKADE'];
      for (const proto of protocols) {
        const adapter = protocolManager.getAdapterIfAvailable(toEngineProtocol(proto));
        if (adapter?.isConnected()) {
          return { isRunning: true, port: 0, lightningPort: 0 };
        }
      }

      throw new Error('No wallet protocols connected');
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const stopNode = createAsyncThunk(
  'node/stop',
  async (_, { rejectWithValue }) => {
    try {
      await protocolManager.disconnectAll();
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
    setNodeInfo: (state, action) => {
      state.nodeInfo = action.payload;
    },
    setNetworkInfo: (state, action) => {
      state.networkInfo = action.payload;
    },
    setError: (state, action) => {
      state.error = action.payload;
    },
    clearError: (state) => {
      state.error = null;
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
        state.status = {
          isRunning: action.payload.isRunning,
          port: action.payload.port,
          lightningPort: action.payload.lightningPort,
        };
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
        state.nodeInfo = null;
      })
      .addCase(stopNode.rejected, (state, action) => {
        state.isStopping = false;
        state.error = action.payload as string;
      });
  },
});

export const { setNodeInfo, setNetworkInfo, setError, clearError } = nodeSlice.actions;
export default nodeSlice.reducer;
