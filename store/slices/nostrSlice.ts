// store/slices/nostrSlice.ts
import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import NostrService, { NostrProfile, NostrContact, NostrSettings } from '../../services/NostrService';

// Async thunks for Nostr operations
export const initializeNostr = createAsyncThunk(
  'nostr/initialize',
  async (settings?: NostrSettings) => {
    const nostrService = NostrService.getInstance();
    const success = await nostrService.initialize(settings);
    return success;
  }
);

export const loadNostrProfile = createAsyncThunk(
  'nostr/loadProfile',
  async () => {
    const nostrService = NostrService.getInstance();
    const profile = await nostrService.getUserProfile();
    return profile;
  }
);

export const updateNostrProfile = createAsyncThunk(
  'nostr/updateProfile',
  async (profile: Partial<NostrProfile>) => {
    const nostrService = NostrService.getInstance();
    const success = await nostrService.updateProfile(profile);
    if (success) {
      return profile;
    }
    throw new Error('Failed to update profile');
  }
);

export const loadContactList = createAsyncThunk(
  'nostr/loadContactList',
  async () => {
    const nostrService = NostrService.getInstance();
    const contacts = await nostrService.getContactList();
    return contacts;
  }
);

export const followUser = createAsyncThunk(
  'nostr/followUser',
  async ({ pubkey, relay, petname }: { pubkey: string; relay?: string; petname?: string }) => {
    const nostrService = NostrService.getInstance();
    const success = await nostrService.followUser(pubkey, relay, petname);
    if (success) {
      return { pubkey, relay, petname };
    }
    throw new Error('Failed to follow user');
  }
);

export const unfollowUser = createAsyncThunk(
  'nostr/unfollowUser',
  async (pubkey: string) => {
    const nostrService = NostrService.getInstance();
    const success = await nostrService.unfollowUser(pubkey);
    if (success) {
      return pubkey;
    }
    throw new Error('Failed to unfollow user');
  }
);

export const getUserInfo = createAsyncThunk(
  'nostr/getUserInfo',
  async (pubkey: string) => {
    const nostrService = NostrService.getInstance();
    const userInfo = await nostrService.getUserInfo(pubkey);
    return { pubkey, ...userInfo };
  }
);

interface NostrState {
  // Connection status
  isConnected: boolean;
  isInitializing: boolean;
  
  // User profile
  profile: NostrProfile | null;
  isProfileLoading: boolean;
  profileError: string | null;
  
  // Keys and identity
  privateKey: string | null;
  publicKey: string | null;
  npub: string | null;
  nsec: string | null;
  
  // Contacts
  contacts: NostrContact[];
  isContactsLoading: boolean;
  contactsError: string | null;
  contactsLastUpdated: number | null;
  
  // Settings
  relays: string[];
  
  // Wallet Connect (placeholder)
  walletConnectEnabled: boolean;
  connectedWallet: string | null;
  
  // UI State
  showContactSync: boolean;
  subscriptionId: string | null;
  
  // General error state
  error: string | null;
}

const initialState: NostrState = {
  isConnected: false,
  isInitializing: false,
  
  profile: null,
  isProfileLoading: false,
  profileError: null,
  
  privateKey: null,
  publicKey: null,
  npub: null,
  nsec: null,
  
  contacts: [],
  isContactsLoading: false,
  contactsError: null,
  contactsLastUpdated: null,
  
  relays: [
    'wss://relay.damus.io',
    'wss://relay.snort.social',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://nostr.wine',
  ],
  
  walletConnectEnabled: false,
  connectedWallet: null,
  
  showContactSync: false,
  subscriptionId: null,
  
  error: null,
};

const nostrSlice = createSlice({
  name: 'nostr',
  initialState,
  reducers: {
    // Connection management
    setConnected: (state, action: PayloadAction<boolean>) => {
      state.isConnected = action.payload;
      if (!action.payload) {
        // Clear sensitive data when disconnected
        state.privateKey = null;
        state.publicKey = null;
        state.npub = null;
        state.nsec = null;
        state.profile = null;
        state.contacts = [];
      }
    },
    
    // Keys management
    setKeys: (state, action: PayloadAction<{
      privateKey: string;
      publicKey: string;
      npub: string;
      nsec: string;
    }>) => {
      state.privateKey = action.payload.privateKey;
      state.publicKey = action.payload.publicKey;
      state.npub = action.payload.npub;
      state.nsec = action.payload.nsec;
    },
    
    clearKeys: (state) => {
      state.privateKey = null;
      state.publicKey = null;
      state.npub = null;
      state.nsec = null;
    },
    
    // Profile management
    setProfile: (state, action: PayloadAction<NostrProfile | null>) => {
      state.profile = action.payload;
    },
    
    updateProfileField: (state, action: PayloadAction<{ field: keyof NostrProfile; value: string }>) => {
      if (state.profile) {
        state.profile[action.payload.field] = action.payload.value;
      }
    },
    
    // Contacts management
    setContacts: (state, action: PayloadAction<NostrContact[]>) => {
      state.contacts = action.payload;
      state.contactsLastUpdated = Date.now();
    },
    
    addContact: (state, action: PayloadAction<NostrContact>) => {
      const exists = state.contacts.find(c => c.pubkey === action.payload.pubkey);
      if (!exists) {
        state.contacts.push(action.payload);
        state.contactsLastUpdated = Date.now();
      }
    },
    
    removeContact: (state, action: PayloadAction<string>) => {
      state.contacts = state.contacts.filter(c => c.pubkey !== action.payload);
      state.contactsLastUpdated = Date.now();
    },
    
    updateContactProfile: (state, action: PayloadAction<{ pubkey: string; profile: NostrProfile }>) => {
      const contact = state.contacts.find(c => c.pubkey === action.payload.pubkey);
      if (contact) {
        contact.profile = action.payload.profile;
      }
    },
    
    // Relays management
    setRelays: (state, action: PayloadAction<string[]>) => {
      state.relays = action.payload;
    },
    
    addRelay: (state, action: PayloadAction<string>) => {
      if (!state.relays.includes(action.payload)) {
        state.relays.push(action.payload);
      }
    },
    
    removeRelay: (state, action: PayloadAction<string>) => {
      state.relays = state.relays.filter(relay => relay !== action.payload);
    },
    
    // Wallet Connect (placeholder)
    setWalletConnectEnabled: (state, action: PayloadAction<boolean>) => {
      state.walletConnectEnabled = action.payload;
    },
    
    setConnectedWallet: (state, action: PayloadAction<string | null>) => {
      state.connectedWallet = action.payload;
    },
    
    // UI State
    setShowContactSync: (state, action: PayloadAction<boolean>) => {
      state.showContactSync = action.payload;
    },
    
    setSubscriptionId: (state, action: PayloadAction<string | null>) => {
      state.subscriptionId = action.payload;
    },
    
    // Error management
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    
    clearError: (state) => {
      state.error = null;
    },
    
    clearContactsError: (state) => {
      state.contactsError = null;
    },
    
    clearProfileError: (state) => {
      state.profileError = null;
    },
    
    // Reset state
    resetNostr: () => initialState,
  },
  
  extraReducers: (builder) => {
    // Initialize Nostr
    builder
      .addCase(initializeNostr.pending, (state) => {
        state.isInitializing = true;
        state.error = null;
      })
      .addCase(initializeNostr.fulfilled, (state, action) => {
        state.isInitializing = false;
        state.isConnected = action.payload;
        if (!action.payload) {
          state.error = 'Failed to connect to Nostr network';
        }
      })
      .addCase(initializeNostr.rejected, (state, action) => {
        state.isInitializing = false;
        state.isConnected = false;
        state.error = action.error.message || 'Failed to initialize Nostr';
      });
    
    // Load profile
    builder
      .addCase(loadNostrProfile.pending, (state) => {
        state.isProfileLoading = true;
        state.profileError = null;
      })
      .addCase(loadNostrProfile.fulfilled, (state, action) => {
        state.isProfileLoading = false;
        state.profile = action.payload;
      })
      .addCase(loadNostrProfile.rejected, (state, action) => {
        state.isProfileLoading = false;
        state.profileError = action.error.message || 'Failed to load profile';
      });
    
    // Update profile
    builder
      .addCase(updateNostrProfile.pending, (state) => {
        state.isProfileLoading = true;
        state.profileError = null;
      })
      .addCase(updateNostrProfile.fulfilled, (state, action) => {
        state.isProfileLoading = false;
        if (state.profile) {
          state.profile = { ...state.profile, ...action.payload };
        } else {
          state.profile = action.payload as NostrProfile;
        }
      })
      .addCase(updateNostrProfile.rejected, (state, action) => {
        state.isProfileLoading = false;
        state.profileError = action.error.message || 'Failed to update profile';
      });
    
    // Load contacts
    builder
      .addCase(loadContactList.pending, (state) => {
        state.isContactsLoading = true;
        state.contactsError = null;
      })
      .addCase(loadContactList.fulfilled, (state, action) => {
        state.isContactsLoading = false;
        state.contacts = action.payload;
        state.contactsLastUpdated = Date.now();
      })
      .addCase(loadContactList.rejected, (state, action) => {
        state.isContactsLoading = false;
        state.contactsError = action.error.message || 'Failed to load contacts';
      });
    
    // Follow user
    builder
      .addCase(followUser.fulfilled, (state, action) => {
        // The contact will be added when we reload the contact list
        state.contactsError = null;
      })
      .addCase(followUser.rejected, (state, action) => {
        state.contactsError = action.error.message || 'Failed to follow user';
      });
    
    // Unfollow user
    builder
      .addCase(unfollowUser.fulfilled, (state, action) => {
        state.contacts = state.contacts.filter(c => c.pubkey !== action.payload);
        state.contactsLastUpdated = Date.now();
      })
      .addCase(unfollowUser.rejected, (state, action) => {
        state.contactsError = action.error.message || 'Failed to unfollow user';
      });
    
    // Get user info
    builder
      .addCase(getUserInfo.fulfilled, (state, action) => {
        const { pubkey, profile } = action.payload;
        const contact = state.contacts.find(c => c.pubkey === pubkey);
        if (contact && profile) {
          contact.profile = profile;
        }
      });
  },
});

export const {
  setConnected,
  setKeys,
  clearKeys,
  setProfile,
  updateProfileField,
  setContacts,
  addContact,
  removeContact,
  updateContactProfile,
  setRelays,
  addRelay,
  removeRelay,
  setWalletConnectEnabled,
  setConnectedWallet,
  setShowContactSync,
  setSubscriptionId,
  setError,
  clearError,
  clearContactsError,
  clearProfileError,
  resetNostr,
} = nostrSlice.actions;

export default nostrSlice.reducer; 