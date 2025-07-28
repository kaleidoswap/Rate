// store/slices/nostrSlice.ts
import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import * as SecureStore from 'expo-secure-store';
import NostrService, { NostrProfile, NostrContact, NostrSettings } from '../../services/NostrService';

// Secure storage keys
const NOSTR_PRIVATE_KEY = 'nostr_private_key';
const NOSTR_NSEC_KEY = 'nostr_nsec_key';

// Async thunks for secure key operations
export const saveKeysSecurely = createAsyncThunk(
  'nostr/saveKeysSecurely',
  async ({ privateKey, nsec }: { privateKey: string; nsec: string }) => {
    await SecureStore.setItemAsync(NOSTR_PRIVATE_KEY, privateKey);
    await SecureStore.setItemAsync(NOSTR_NSEC_KEY, nsec);
    return { saved: true };
  }
);

export const loadKeysSecurely = createAsyncThunk(
  'nostr/loadKeysSecurely',
  async () => {
    const privateKey = await SecureStore.getItemAsync(NOSTR_PRIVATE_KEY);
    const nsec = await SecureStore.getItemAsync(NOSTR_NSEC_KEY);
    return { privateKey, nsec };
  }
);

export const clearKeysSecurely = createAsyncThunk(
  'nostr/clearKeysSecurely',
  async () => {
    await SecureStore.deleteItemAsync(NOSTR_PRIVATE_KEY);
    await SecureStore.deleteItemAsync(NOSTR_NSEC_KEY);
    return { cleared: true };
  }
);

export const restoreNostrConnection = createAsyncThunk(
  'nostr/restoreConnection',
  async (_, { getState }: any) => {
    const state = getState();
    const { relays } = state.nostr;
    
    const privateKey = await SecureStore.getItemAsync(NOSTR_PRIVATE_KEY);
    if (!privateKey) {
      throw new Error('No stored private key found');
    }

    const nostrService = NostrService.getInstance();
    const settings: NostrSettings = {
      privateKey,
      relays,
    };
    
    const success = await nostrService.initialize(settings);
    return { success, privateKey };
  }
);

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
  // Connection status (not persisted - determined at runtime)
  isConnected: boolean;
  isInitializing: boolean;
  
  // User profile (persisted)
  profile: NostrProfile | null;
  isProfileLoading: boolean;
  profileError: string | null;
  
  // Keys and identity (private keys stored securely, public data persisted)
  privateKey: string | null; // NOT persisted - loaded from secure storage
  publicKey: string | null; // persisted
  npub: string | null; // persisted  
  nsec: string | null; // NOT persisted - loaded from secure storage
  hasStoredKeys: boolean; // persisted - indicates if keys are saved securely
  
  // Contacts (persisted)
  contacts: NostrContact[];
  isContactsLoading: boolean;
  contactsError: string | null;
  contactsLastUpdated: number | null;
  
  // Settings (persisted)
  relays: string[];
  isRelaysExpanded: boolean; // UI state for condensed relay view
  
  // Wallet Connect (persisted settings, not connection state)
  walletConnectEnabled: boolean;
  connectedWallet: string | null;
  nwcConnectionString: string | null; // persisted for easy access
  
  // UI State (some persisted, some not)
  showContactSync: boolean;
  subscriptionId: string | null; // not persisted
  
  // General error state (not persisted)
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
  hasStoredKeys: false,
  
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
  isRelaysExpanded: false,
  
  walletConnectEnabled: false,
  connectedWallet: null,
  nwcConnectionString: null,
  
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
        // Only clear runtime data when disconnected, keep persisted data
        state.privateKey = null;
        state.nsec = null;
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
      state.hasStoredKeys = true; // Will be saved securely
    },
    
    setPublicKeyData: (state, action: PayloadAction<{
      publicKey: string;
      npub: string;
    }>) => {
      state.publicKey = action.payload.publicKey;
      state.npub = action.payload.npub;
    },
    
    clearKeys: (state) => {
      state.privateKey = null;
      state.publicKey = null;
      state.npub = null;
      state.nsec = null;
      state.hasStoredKeys = false;
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
    
    setRelaysExpanded: (state, action: PayloadAction<boolean>) => {
      state.isRelaysExpanded = action.payload;
    },
    
    // Wallet Connect
    setWalletConnectEnabled: (state, action: PayloadAction<boolean>) => {
      state.walletConnectEnabled = action.payload;
    },
    
    setConnectedWallet: (state, action: PayloadAction<string | null>) => {
      state.connectedWallet = action.payload;
    },
    
    setNWCConnectionString: (state, action: PayloadAction<string | null>) => {
      state.nwcConnectionString = action.payload;
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
    
    // Secure key operations
    builder
      .addCase(saveKeysSecurely.fulfilled, (state) => {
        state.hasStoredKeys = true;
      })
      .addCase(saveKeysSecurely.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to save keys securely';
      });
    
    builder
      .addCase(loadKeysSecurely.fulfilled, (state, action) => {
        if (action.payload.privateKey && action.payload.nsec) {
          state.privateKey = action.payload.privateKey;
          state.nsec = action.payload.nsec;
          state.hasStoredKeys = true;
        } else {
          state.hasStoredKeys = false;
        }
      })
      .addCase(loadKeysSecurely.rejected, (state, action) => {
        state.hasStoredKeys = false;
        state.error = action.error.message || 'Failed to load stored keys';
      });
    
    builder
      .addCase(clearKeysSecurely.fulfilled, (state) => {
        state.privateKey = null;
        state.nsec = null;
        state.hasStoredKeys = false;
      });
    
    // Restore connection
    builder
      .addCase(restoreNostrConnection.pending, (state) => {
        state.isInitializing = true;
        state.error = null;
      })
      .addCase(restoreNostrConnection.fulfilled, (state, action) => {
        state.isInitializing = false;
        state.isConnected = action.payload.success;
        if (action.payload.privateKey) {
          state.privateKey = action.payload.privateKey;
        }
      })
      .addCase(restoreNostrConnection.rejected, (state, action) => {
        state.isInitializing = false;
        state.isConnected = false;
        state.error = action.error.message || 'Failed to restore connection';
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
  setPublicKeyData,
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
  setRelaysExpanded,
  setWalletConnectEnabled,
  setConnectedWallet,
  setNWCConnectionString,
  setShowContactSync,
  setSubscriptionId,
  setError,
  clearError,
  clearContactsError,
  clearProfileError,
  resetNostr,
} = nostrSlice.actions;

export default nostrSlice.reducer; 