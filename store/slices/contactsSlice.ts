// store/slices/contactsSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface Contact {
  id: string;
  name: string;
  lightning_address?: string;
  node_pubkey?: string;
  notes?: string;
  avatar_url?: string;
  created_at: number;
  updated_at: number;
  is_favorite: boolean;
  isNostrContact?: boolean;
  npub?: string;
}

interface ContactsState {
  contacts: Contact[];
  isLoading: boolean;
  searchQuery: string;
  selectedContact: Contact | null;
  error: string | null;
  sortBy: 'name' | 'created_at' | 'updated_at';
  sortOrder: 'asc' | 'desc';
}

const initialState: ContactsState = {
  contacts: [],
  isLoading: false,
  searchQuery: '',
  selectedContact: null,
  error: null,
  sortBy: 'name',
  sortOrder: 'asc',
};

const contactsSlice = createSlice({
  name: 'contacts',
  initialState,
  reducers: {
    setContacts: (state, action: PayloadAction<Contact[]>) => {
      state.contacts = action.payload;
    },
    addContact: (state, action: PayloadAction<Contact>) => {
      state.contacts.push(action.payload);
    },
    updateContact: (state, action: PayloadAction<Contact>) => {
      const index = state.contacts.findIndex(c => c.id === action.payload.id);
      if (index !== -1) {
        state.contacts[index] = action.payload;
      }
    },
    deleteContact: (state, action: PayloadAction<string>) => {
      state.contacts = state.contacts.filter(c => c.id !== action.payload);
    },
    toggleFavorite: (state, action: PayloadAction<string>) => {
      const contact = state.contacts.find(c => c.id === action.payload);
      if (contact) {
        contact.is_favorite = !contact.is_favorite;
        contact.updated_at = Date.now();
      }
    },
    setSelectedContact: (state, action: PayloadAction<Contact | null>) => {
      state.selectedContact = action.payload;
    },
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
    setSorting: (state, action: PayloadAction<{
      sortBy: 'name' | 'created_at' | 'updated_at';
      sortOrder: 'asc' | 'desc';
    }>) => {
      state.sortBy = action.payload.sortBy;
      state.sortOrder = action.payload.sortOrder;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
    resetContacts: () => initialState,
  },
});

export const {
  setContacts,
  addContact,
  updateContact,
  deleteContact,
  toggleFavorite,
  setSelectedContact,
  setSearchQuery,
  setSorting,
  setLoading,
  setError,
  clearError,
  resetContacts,
} = contactsSlice.actions;

export default contactsSlice.reducer; 