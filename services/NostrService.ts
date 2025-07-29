// services/NostrService.ts
import NDK, { 
  NDKEvent, 
  NDKFilter, 
  NDKPrivateKeySigner, 
  NDKUser, 
  NDKRelay,
  NDKSubscription,
  NDKKind,
} from '@nostr-dev-kit/ndk';
import { getPublicKey, nip19, utils } from 'nostr-tools';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NWCService from './NWCService';

export interface NostrProfile {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  website?: string;
  nip05?: string;
  lud16?: string; // Lightning address
  lud06?: string; // LNURL-pay
}

export interface NostrContact {
  pubkey: string;
  profile?: NostrProfile;
  relay?: string;
  petname?: string; // Local name for the contact
}

export interface NostrSettings {
  relays: string[];
  privateKey?: string;
  publicKey?: string;
  profile?: NostrProfile;
}

interface NostrWalletConnectInfo {
  relay: string;
  walletPubkey: string;
  secret: string;
}

class NostrService {
  private static instance: NostrService;
  private ndk: NDK | null = null;
  private signer: NDKPrivateKeySigner | null = null;
  private user: NDKUser | null = null;
  private subscriptions: Map<string, NDKSubscription> = new Map();
  private isConnected = false;
  private nwcService: NWCService | null = null;

  // Default relays
  private defaultRelays = [
    'wss://relay.damus.io',
    'wss://relay.snort.social',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://nostr.wine',
  ];

  private constructor() {}

  static getInstance(): NostrService {
    if (!NostrService.instance) {
      NostrService.instance = new NostrService();
    }
    return NostrService.instance;
  }

  // Initialize NDK and connect to relays
  async initialize(settings?: NostrSettings): Promise<boolean> {
    try {
      const relays = settings?.relays || this.defaultRelays;
      
      this.ndk = new NDK({
        explicitRelayUrls: relays,
        enableOutboxModel: true,
      });

      // Set up signer if private key is provided
      if (settings?.privateKey) {
        this.signer = new NDKPrivateKeySigner(settings.privateKey);
        this.ndk.signer = this.signer;
        this.user = await this.signer.user();
      }

      await this.ndk.connect();
      this.isConnected = true;
      console.log('NostrService: Connected to Nostr network');
      return true;
    } catch (error) {
      console.error('NostrService: Failed to initialize:', error);
      return false;
    }
  }

  // Generate new key pair
  generateKeyPair(): { privateKey: string; publicKey: string; nsec: string; npub: string } {
    try {
      // Use crypto.getRandomValues for secure random generation
      const randomArray = new Uint8Array(32);
      crypto.getRandomValues(randomArray);
      const privateKey = utils.bytesToHex(randomArray);
      const publicKey = getPublicKey(randomArray);
      const nsec = nip19.nsecEncode(randomArray);
      const npub = nip19.npubEncode(publicKey);

      return { privateKey, publicKey, nsec, npub };
    } catch (error) {
      console.error('NostrService: Failed to generate key pair:', error);
      throw error;
    }
  }

  // Import existing private key
  importPrivateKey(nsecOrPrivateKey: string): { privateKey: string; publicKey: string; nsec: string; npub: string } | null {
    try {
      let privateKeyBytes: Uint8Array;

      if (nsecOrPrivateKey.startsWith('nsec')) {
        const { type, data } = nip19.decode(nsecOrPrivateKey);
        if (type !== 'nsec') throw new Error('Invalid nsec format');
        privateKeyBytes = data as Uint8Array;
      } else {
        // Validate hex format
        if (!/^[0-9a-f]{64}$/i.test(nsecOrPrivateKey)) {
          throw new Error('Invalid private key format');
        }
        privateKeyBytes = utils.hexToBytes(nsecOrPrivateKey.toLowerCase());
      }

      const privateKey = utils.bytesToHex(privateKeyBytes);
      const publicKey = getPublicKey(privateKeyBytes);
      const nsec = nip19.nsecEncode(privateKeyBytes);
      const npub = nip19.npubEncode(publicKey);

      return { privateKey, publicKey, nsec, npub };
    } catch (error) {
      console.error('NostrService: Failed to import private key:', error);
      return null;
    }
  }

  // Add a new relay
  async addRelay(url: string): Promise<boolean> {
    try {
      if (!url.startsWith('wss://')) {
        throw new Error('Relay URL must start with wss://');
      }

      // Validate URL format
      new URL(url);

      // Add to NDK if connected
      if (this.ndk) {
        // Add to explicit relays
        this.ndk.explicitRelayUrls = [...(this.ndk.explicitRelayUrls || []), url];
        // Reconnect to include new relay
        await this.ndk.connect();
      }

      // Update relays list
      const currentRelays = await this.getRelays();
      if (!currentRelays.includes(url)) {
        await AsyncStorage.setItem('nostr_relays', JSON.stringify([...currentRelays, url]));
      }

      return true;
    } catch (error) {
      console.error('NostrService: Failed to add relay:', error);
      return false;
    }
  }

  // Remove a relay
  async removeRelay(url: string): Promise<boolean> {
    try {
      // Remove from NDK if connected
      if (this.ndk) {
        // Remove from explicit relays
        this.ndk.explicitRelayUrls = (this.ndk.explicitRelayUrls || []).filter(r => r !== url);
        // Disconnect from all relays
        for (const relay of Array.from(this.ndk.pool.relays.values())) {
          await relay.disconnect();
        }
        // Reconnect to remaining relays
        await this.ndk.connect();
      }

      // Update relays list
      const currentRelays = await this.getRelays();
      const updatedRelays = currentRelays.filter(relay => relay !== url);
      await AsyncStorage.setItem('nostr_relays', JSON.stringify(updatedRelays));

      return true;
    } catch (error) {
      console.error('NostrService: Failed to remove relay:', error);
      return false;
    }
  }

  // Get current relays
  async getRelays(): Promise<string[]> {
    try {
      // If NDK is connected, return the actual connected relays
      if (this.ndk && this.ndk.explicitRelayUrls) {
        return this.ndk.explicitRelayUrls;
      }
      
      // Fallback to stored relays
      const storedRelays = await AsyncStorage.getItem('nostr_relays');
      if (storedRelays) {
        return JSON.parse(storedRelays);
      }
      return this.defaultRelays;
    } catch (error) {
      console.error('NostrService: Failed to get relays:', error);
      return this.defaultRelays;
    }
  }

  // Get relay connection status
  getRelayStatus(): { url: string; connected: boolean }[] {
    if (!this.ndk || !this.ndk.pool) {
      return [];
    }

    try {
      const relays = Array.from(this.ndk.pool.relays.values());
      return relays.map(relay => ({
        url: relay.url,
        connected: relay.connectivity.status === 1 // 1 = connected in NDK
      }));
    } catch (error) {
      console.error('NostrService: Failed to get relay status:', error);
      return [];
    }
  }

  // Set up user with existing key
  async setUser(privateKey: string): Promise<boolean> {
    try {
      if (!this.ndk) {
        throw new Error('NDK not initialized');
      }

      this.signer = new NDKPrivateKeySigner(privateKey);
      this.ndk.signer = this.signer;
      this.user = await this.signer.user();
      
      return true;
    } catch (error) {
      console.error('NostrService: Failed to set user:', error);
      return false;
    }
  }

  // Get current user's profile
  async getUserProfile(): Promise<NostrProfile | null> {
    try {
      if (!this.user) return null;

      const profile = await this.user.fetchProfile();
      if (!profile) return null;

      return {
        name: profile.name,
        display_name: profile.displayName,
        about: profile.about,
        picture: profile.image,
        banner: profile.banner,
        website: profile.website,
        nip05: profile.nip05,
        lud16: profile.lud16,
        lud06: profile.lud06,
      };
    } catch (error) {
      console.error('NostrService: Failed to get user profile:', error);
      return null;
    }
  }

  // Update user profile
  async updateProfile(profile: Partial<NostrProfile>): Promise<boolean> {
    try {
      if (!this.ndk || !this.user) {
        throw new Error('NDK or user not initialized');
      }

      const event = new NDKEvent(this.ndk);
      event.kind = NDKKind.Metadata;
      event.content = JSON.stringify(profile);
      
      await event.publish();
      console.log('NostrService: Profile updated successfully');
      return true;
    } catch (error) {
      console.error('NostrService: Failed to update profile:', error);
      return false;
    }
  }

  // Get contact list (following list)
  async getContactList(): Promise<NostrContact[]> {
    try {
      if (!this.ndk || !this.user) {
        throw new Error('NDK or user not initialized');
      }

      const contacts: NostrContact[] = [];
      
      // Get the user's contact list (kind 3)
      const filter: NDKFilter = {
        kinds: [3],
        authors: [this.user.pubkey],
        limit: 1,
      };

      const events = await this.ndk.fetchEvents(filter);
      const contactListEvent = Array.from(events)[0];

      if (!contactListEvent) {
        console.log('NostrService: No contact list found');
        return [];
      }

      // Parse contacts from tags
      for (const tag of contactListEvent.tags) {
        if (tag[0] === 'p') {
          const pubkey = tag[1];
          const relay = tag[2];
          const petname = tag[3];

          contacts.push({
            pubkey,
            relay,
            petname,
          });
        }
      }

      // Fetch profiles for contacts
      await this.fetchContactProfiles(contacts);

      return contacts;
    } catch (error) {
      console.error('NostrService: Failed to get contact list:', error);
      return [];
    }
  }

  // Fetch profiles for contacts
  private async fetchContactProfiles(contacts: NostrContact[]): Promise<void> {
    try {
      if (!this.ndk || contacts.length === 0) return;

      const pubkeys = contacts.map(c => c.pubkey);
      
      const filter: NDKFilter = {
        kinds: [0], // Metadata events
        authors: pubkeys,
      };

      const profileEvents = await this.ndk.fetchEvents(filter);

      // Map profiles to contacts
      const profileMap = new Map<string, NostrProfile>();
      
      for (const event of profileEvents) {
        try {
          const profile = JSON.parse(event.content) as NostrProfile;
          profileMap.set(event.pubkey, profile);
        } catch (error) {
          console.warn('NostrService: Failed to parse profile for', event.pubkey);
        }
      }

      // Update contacts with profiles
      for (const contact of contacts) {
        const profile = profileMap.get(contact.pubkey);
        if (profile) {
          contact.profile = profile;
        }
      }
    } catch (error) {
      console.error('NostrService: Failed to fetch contact profiles:', error);
    }
  }

  // Follow a user
  async followUser(pubkey: string, relay?: string, petname?: string): Promise<boolean> {
    try {
      if (!this.ndk || !this.user) {
        throw new Error('NDK or user not initialized');
      }

      // Get current contact list
      const currentContacts = await this.getContactList();
      
      // Check if already following
      if (currentContacts.some(c => c.pubkey === pubkey)) {
        console.log('NostrService: Already following user');
        return true;
      }

      // Create new contact list event
      const event = new NDKEvent(this.ndk);
      event.kind = 3; // Contact list
      
      // Add existing contacts
      for (const contact of currentContacts) {
        const tag = ['p', contact.pubkey];
        if (contact.relay) tag.push(contact.relay);
        if (contact.petname) tag.push(contact.petname);
        event.tags.push(tag);
      }

      // Add new contact
      const newTag = ['p', pubkey];
      if (relay) newTag.push(relay);
      if (petname) newTag.push(petname);
      event.tags.push(newTag);

      await event.publish();
      console.log('NostrService: Successfully followed user');
      return true;
    } catch (error) {
      console.error('NostrService: Failed to follow user:', error);
      return false;
    }
  }

  // Unfollow a user
  async unfollowUser(pubkey: string): Promise<boolean> {
    try {
      if (!this.ndk || !this.user) {
        throw new Error('NDK or user not initialized');
      }

      // Get current contact list
      const currentContacts = await this.getContactList();
      
      // Filter out the user to unfollow
      const updatedContacts = currentContacts.filter(c => c.pubkey !== pubkey);

      // Create new contact list event
      const event = new NDKEvent(this.ndk);
      event.kind = 3; // Contact list
      
      // Add remaining contacts
      for (const contact of updatedContacts) {
        const tag = ['p', contact.pubkey];
        if (contact.relay) tag.push(contact.relay);
        if (contact.petname) tag.push(contact.petname);
        event.tags.push(tag);
      }

      await event.publish();
      console.log('NostrService: Successfully unfollowed user');
      return true;
    } catch (error) {
      console.error('NostrService: Failed to unfollow user:', error);
      return false;
    }
  }

  // Subscribe to contact list updates
  subscribeToContactList(callback: (contacts: NostrContact[]) => void): string {
    if (!this.ndk || !this.user) {
      throw new Error('NDK or user not initialized');
    }

    const subscriptionId = `contacts_${Date.now()}`;
    
    const filter: NDKFilter = {
      kinds: [3],
      authors: [this.user.pubkey],
    };

    const subscription = this.ndk.subscribe(filter);
    
    subscription.on('event', async (event: NDKEvent) => {
      const contacts: NostrContact[] = [];
      
      for (const tag of event.tags) {
        if (tag[0] === 'p') {
          contacts.push({
            pubkey: tag[1],
            relay: tag[2],
            petname: tag[3],
          });
        }
      }

      await this.fetchContactProfiles(contacts);
      callback(contacts);
    });

    this.subscriptions.set(subscriptionId, subscription);
    return subscriptionId;
  }

  // Unsubscribe from updates
  unsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      subscription.stop();
      this.subscriptions.delete(subscriptionId);
    }
  }

  // Get user info by pubkey
  async getUserInfo(pubkey: string): Promise<{ profile: NostrProfile | null; npub: string }> {
    try {
      const npub = nip19.npubEncode(pubkey);
      
      if (!this.ndk) {
        return { profile: null, npub };
      }

      const user = this.ndk.getUser({ pubkey });
      const profile = await user.fetchProfile();

      if (!profile) {
        return { profile: null, npub };
      }

      return {
        profile: {
          name: profile.name,
          display_name: profile.displayName,
          about: profile.about,
          picture: profile.image,
          banner: profile.banner,
          website: profile.website,
          nip05: profile.nip05,
          lud16: profile.lud16,
          lud06: profile.lud06,
        },
        npub,
      };
    } catch (error) {
      console.error('NostrService: Failed to get user info:', error);
      const npub = nip19.npubEncode(pubkey);
      return { profile: null, npub };
    }
  }

  // Save settings to AsyncStorage
  async saveSettings(settings: NostrSettings): Promise<void> {
    try {
      await AsyncStorage.setItem('nostr_settings', JSON.stringify(settings));
    } catch (error) {
      console.error('NostrService: Failed to save settings:', error);
    }
  }

  // Load settings from AsyncStorage
  async loadSettings(): Promise<NostrSettings | null> {
    try {
      const settingsStr = await AsyncStorage.getItem('nostr_settings');
      if (!settingsStr) return null;
      
      return JSON.parse(settingsStr) as NostrSettings;
    } catch (error) {
      console.error('NostrService: Failed to load settings:', error);
      return null;
    }
  }

  // Wallet Connect related methods
  
  // Initialize NWC service
  async initializeNWC(relays?: string[]): Promise<boolean> {
    try {
      this.nwcService = NWCService.getInstance();
      const success = await this.nwcService.initialize(relays || this.defaultRelays);
      
      if (success) {
        await this.nwcService.start();
        console.log('NostrService: NWC service initialized and started');
      }
      
      return success;
    } catch (error) {
      console.error('NostrService: Failed to initialize NWC:', error);
      return false;
    }
  }

  // Get wallet connect connection string for NWC setup
  async getWalletConnectInfo(permissions: string[] = [], lud16?: string): Promise<string | null> {
    try {
      if (!this.nwcService) {
        console.warn('NostrService: NWC service not initialized');
        return null;
      }

      return await this.nwcService.generateConnectionString(permissions, lud16);
    } catch (error) {
      console.error('NostrService: Failed to generate connection string:', error);
      return null;
    }
  }

  // Parse and validate a wallet connect connection string
  parseWalletConnectString(connectionString: string): any {
    if (!this.nwcService) {
      console.warn('NostrService: NWC service not initialized');
      return null;
    }

    return this.nwcService.parseConnectionString(connectionString);
  }

  // Get NWC service status
  getNWCStatus(): { isRunning: boolean; connections: number; supportedMethods: string[] } | null {
    if (!this.nwcService) {
      return null;
    }

    return this.nwcService.getStatus();
  }

  // Get wallet public key
  async getWalletPubkey(): Promise<string | null> {
    if (!this.nwcService) {
      return null;
    }

    return await this.nwcService.getWalletPubkey();
  }

  // Stop NWC service
  async stopNWC(): Promise<void> {
    if (this.nwcService) {
      await this.nwcService.stop();
      console.log('NostrService: NWC service stopped');
    }
  }

  // Cleanup
  async disconnect(): Promise<void> {
    try {
      // Stop NWC service
      await this.stopNWC();

      // Stop all subscriptions
      for (const subscription of this.subscriptions.values()) {
        subscription.stop();
      }
      this.subscriptions.clear();

      // Disconnect from relays
      if (this.ndk) {
        // NDK doesn't have explicit disconnect method, but we can clean up
        this.ndk = null;
      }

      this.signer = null;
      this.user = null;
      this.isConnected = false;
      this.nwcService = null;
      
      console.log('NostrService: Disconnected from Nostr network');
    } catch (error) {
      console.error('NostrService: Failed to disconnect:', error);
    }
  }

  // Getters
  get connected(): boolean {
    return this.isConnected;
  }

  get currentUser(): NDKUser | null {
    return this.user;
  }

  get ndkInstance(): NDK | null {
    return this.ndk;
  }
}

export default NostrService; 