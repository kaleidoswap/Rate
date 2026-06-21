// store/slices/chatSlice.ts
//
// Encrypted direct-message (NIP-04 / NIP-44) state. Conversations are keyed by
// the counterparty's hex pubkey. Decrypted plaintext is cached here (and
// persisted via redux-persist) so chat history survives restarts and shows
// instantly while the relays are re-queried — mirroring how `contacts` is
// persisted. Sending/encryption is handled by NostrService.
import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import NostrService, {
  DirectMessage,
  DMScheme,
  ChatPaymentRequest,
  ChatPaymentReceipt,
} from '../../services/NostrService';

// Insert a message into a chronologically-sorted list, de-duplicated by event id.
function upsert(list: DirectMessage[], message: DirectMessage): DirectMessage[] {
  if (list.some(m => m.id === message.id)) return list;
  const next = [...list, message];
  next.sort((a, b) => a.createdAt - b.createdAt);
  return next;
}

// Self-heal the slice's map fields. Older persisted `chat` state (saved before
// these were added) rehydrates without them, so any reducer that indexes them
// would crash. Cheap to run on every mutation.
function ensureMaps(state: ChatState): void {
  if (!state.conversations) state.conversations = {};
  if (!state.loadingByPubkey) state.loadingByPubkey = {};
  if (!state.unreadByPubkey) state.unreadByPubkey = {};
  if (!state.paidInvoices) state.paidInvoices = {};
}

export const loadConversation = createAsyncThunk(
  'chat/loadConversation',
  async (pubkey: string) => {
    const messages = await NostrService.getInstance().fetchConversation(pubkey);
    return { pubkey, messages };
  },
);

export const sendDirectMessage = createAsyncThunk(
  'chat/sendDirectMessage',
  async ({ pubkey, text }: { pubkey: string; text: string }, { getState }: any) => {
    const scheme: DMScheme = getState().chat.sendScheme;
    const message = await NostrService.getInstance().sendDirectMessage(pubkey, text, scheme);
    return { pubkey, message };
  },
);

export const sendPaymentRequest = createAsyncThunk(
  'chat/sendPaymentRequest',
  async ({ pubkey, req }: { pubkey: string; req: ChatPaymentRequest }, { getState }: any) => {
    const scheme: DMScheme = getState().chat.sendScheme;
    const message = await NostrService.getInstance().sendPaymentRequest(pubkey, req, scheme);
    return { pubkey, message };
  },
);

export const sendPaymentReceipt = createAsyncThunk(
  'chat/sendPaymentReceipt',
  async ({ pubkey, receipt }: { pubkey: string; receipt: ChatPaymentReceipt }, { getState }: any) => {
    const scheme: DMScheme = getState().chat.sendScheme;
    const message = await NostrService.getInstance().sendPaymentReceipt(pubkey, receipt, scheme);
    return { pubkey, message };
  },
);

interface ChatState {
  // counterparty pubkey (hex) -> messages, oldest first
  conversations: Record<string, DirectMessage[]>;
  // Per-conversation load state (not heavily used, but handy for spinners)
  loadingByPubkey: Record<string, boolean>;
  // counterparty pubkey -> count of unread incoming messages
  unreadByPubkey: Record<string, number>;
  // The conversation currently open on screen; its incoming messages don't
  // count as unread or raise notifications. Not meaningfully persisted (reset
  // to null on app start by the notifier).
  activePubkey: string | null;
  // Invoices (by raw string) the user has paid from the chat, so a request
  // bubble can render a "Paid" state across restarts.
  paidInvoices: Record<string, boolean>;
  // Preferred outbound encryption scheme. NIP-17 (gift-wrapped) by default for
  // metadata-private DMs; the chat screen can switch to legacy nip44/nip04 for
  // interop with older clients.
  sendScheme: DMScheme;
  error: string | null;
}

const initialState: ChatState = {
  conversations: {},
  loadingByPubkey: {},
  unreadByPubkey: {},
  activePubkey: null,
  paidInvoices: {},
  sendScheme: 'nip17',
  error: null,
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    // Record a message into a conversation (used by the live subscription, the
    // app-level inbox notifier, and optimistic local echo). `pubkey` is the
    // counterparty. Bumps the unread count for genuinely-new incoming messages
    // unless that conversation is currently open.
    receiveMessage: (
      state,
      action: PayloadAction<{ pubkey: string; message: DirectMessage; countUnread?: boolean }>,
    ) => {
      ensureMaps(state);
      const { pubkey, message, countUnread } = action.payload;
      const before = state.conversations[pubkey]?.length ?? 0;
      state.conversations[pubkey] = upsert(state.conversations[pubkey] ?? [], message);
      const added = state.conversations[pubkey].length > before;
      // Only count toward unread for genuinely-new, live incoming messages (the
      // notifier sets countUnread); replayed history and our own echoes don't.
      if (added && countUnread && !message.mine && state.activePubkey !== pubkey) {
        state.unreadByPubkey[pubkey] = (state.unreadByPubkey[pubkey] ?? 0) + 1;
      }
    },

    // Mark which conversation is on screen; opening one clears its unread count.
    setActiveConversation: (state, action: PayloadAction<string | null>) => {
      ensureMaps(state);
      state.activePubkey = action.payload;
      if (action.payload) state.unreadByPubkey[action.payload] = 0;
    },

    markRead: (state, action: PayloadAction<string>) => {
      ensureMaps(state);
      state.unreadByPubkey[action.payload] = 0;
    },

    markPaid: (state, action: PayloadAction<string>) => {
      ensureMaps(state);
      state.paidInvoices[action.payload] = true;
    },

    setSendScheme: (state, action: PayloadAction<DMScheme>) => {
      state.sendScheme = action.payload;
    },

    clearConversation: (state, action: PayloadAction<string>) => {
      delete state.conversations[action.payload];
    },

    clearChatError: (state) => {
      state.error = null;
    },

    resetChat: () => initialState,
  },

  extraReducers: (builder) => {
    builder
      .addCase(loadConversation.pending, (state, action) => {
        ensureMaps(state);
        state.loadingByPubkey[action.meta.arg] = true;
        state.error = null;
      })
      .addCase(loadConversation.fulfilled, (state, action) => {
        ensureMaps(state);
        const { pubkey, messages } = action.payload;
        state.loadingByPubkey[pubkey] = false;
        // Merge fetched history with anything we already have (optimistic sends,
        // live events) so nothing is dropped.
        let list = state.conversations[pubkey] ?? [];
        for (const m of messages) list = upsert(list, m);
        state.conversations[pubkey] = list;
      })
      .addCase(loadConversation.rejected, (state, action) => {
        state.loadingByPubkey[action.meta.arg] = false;
        state.error = action.error.message || 'Failed to load messages';
      });

    const storeFulfilled = (
      state: ChatState,
      action: PayloadAction<{ pubkey: string; message: DirectMessage }>,
    ) => {
      ensureMaps(state);
      const { pubkey, message } = action.payload;
      state.conversations[pubkey] = upsert(state.conversations[pubkey] ?? [], message);
    };

    builder
      .addCase(sendDirectMessage.fulfilled, storeFulfilled)
      .addCase(sendDirectMessage.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to send message';
      })
      .addCase(sendPaymentRequest.fulfilled, storeFulfilled)
      .addCase(sendPaymentRequest.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to send payment request';
      })
      .addCase(sendPaymentReceipt.fulfilled, storeFulfilled)
      .addCase(sendPaymentReceipt.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to send receipt';
      });
  },
});

export const {
  receiveMessage,
  setActiveConversation,
  markRead,
  markPaid,
  setSendScheme,
  clearConversation,
  clearChatError,
  resetChat,
} = chatSlice.actions;

// Total unread across all conversations (for a global badge).
export const selectTotalUnread = (state: { chat: ChatState }): number =>
  Object.values(state.chat.unreadByPubkey || {}).reduce((sum, n) => sum + (n || 0), 0);

export default chatSlice.reducer;
