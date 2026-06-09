// services/NostrService.ts
import NDK, {
  NDKEvent,
  NDKFilter,
  NDKPrivateKeySigner,
  NDKUser,
  NDKRelay,
  NDKSubscription,
  NDKKind,
  getNip57ZapSpecFromLud,
  generateZapRequest,
  type NDKLnUrlData,
} from '@nostr-dev-kit/ndk';
import { getPublicKey, nip19, utils, nip04, nip44, nip17, nip59 } from 'nostr-tools';
import { bech32 } from '@scure/base';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NWCService from './NWCService';

// NIP-06 derivation path for Nostr keys from a BIP39 mnemonic.
// m/44'/1237'/<account>'/0/0 — 1237 is the registered Nostr coin type.
const NOSTR_DERIVATION_PATH = (account = 0) => `m/44'/1237'/${account}'/0/0`;

function decodeNpriv(npriv: string): Uint8Array {
  const decoded = bech32.decodeToBytes(npriv.trim());
  if (decoded.prefix !== 'npriv') {
    throw new Error('Invalid npriv prefix');
  }
  if (decoded.bytes.length !== 32) {
    throw new Error(`Invalid npriv payload length: ${decoded.bytes.length}`);
  }
  return decoded.bytes;
}

function normalizeNostrPrivateKeyInput(input: string): string {
  return input
    .trim()
    .replace(/^nostr:/i, '')
    .replace(/\s+/g, '');
}

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

// Encryption scheme for an encrypted direct message.
//  - nip17: gift-wrapped private DM (NIP-17 + NIP-59). A kind-14 rumor is sealed
//    (kind 13) and gift-wrapped (kind 1059) under a throwaway key, hiding sender,
//    timestamp, and metadata. The modern, recommended default.
//  - nip44: ChaCha20 + HMAC-SHA256 encryption in a legacy kind-4 event.
//  - nip04: AES-256-CBC (content suffixed with `?iv=`) in a kind-4 event; the
//    deprecated original, kept for interop with older clients.
export type DMScheme = 'nip17' | 'nip44' | 'nip04';

// A payment request embedded in a private DM — see docs/nip-payment-requests.md.
// Carried as structured tags on a NIP-17 kind-14 rumor (gift-wrapped); the
// message content also holds a human-readable fallback for non-aware clients.
export interface ChatPaymentRequest {
  requestId?: string;   // correlates the later receipt
  invoice: string;      // payable BOLT11 (BTC, or RGB-over-Lightning)
  amountMsat?: number;  // BTC amount, NIP-57 style (omit for asset-only)
  description?: string; // what the payment is for
  expiry?: number;      // unix seconds
  asset?: {             // present for RGB-asset requests
    id: string;
    ticker?: string;
    precision?: number;
    amount?: number;    // whole asset units (display)
  };
}

export interface ChatPaymentReceipt {
  requestId?: string;
  status: 'paid' | 'declined' | 'expired';
  preimage?: string;    // proof of payment, when available
}

export interface DirectMessage {
  id: string;          // Nostr event id (the kind-14 rumor id for NIP-17)
  pubkey: string;      // author (sender) pubkey, hex
  recipient: string;   // recipient pubkey, hex (from the `p` tag)
  content: string;     // decrypted plaintext
  createdAt: number;   // unix seconds (the rumor's time for NIP-17)
  mine: boolean;       // true when authored by the current user
  scheme: DMScheme;    // how the message was decrypted
  payment?: ChatPaymentRequest; // structured payment request (NIP-17 only)
  receipt?: ChatPaymentReceipt; // structured payment receipt (NIP-17 only)
}

// Legacy NIP-04/NIP-44 encrypted DMs share kind 4. NIP-17 uses kinds 14 (rumor)
// and 1059 (gift wrap); the gift wrap is what travels over relays.
const DM_KIND = 4;
const PRIVATE_DM_KIND = 14; // NIP-17 chat rumor
const GIFT_WRAP_KIND = 1059; // NIP-59 gift wrap

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

  // Default relays. Chosen for reliability and open (no-auth, no-payment) read
  // access — relay.snort.social is frequently offline and nostr.wine requires a
  // paid subscription, both of which made connections look "broken". purplepag.es
  // is an indexer optimised for profile (kind 0) and relay-list (kind 10002)
  // lookups, which speeds up contact resolution under the outbox model.
  private defaultRelays = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://relay.primal.net',
    'wss://purplepag.es',
  ];

  // The most recent kind-3 (NIP-02) follow-list event we have seen for the user.
  // Retained so follow/unfollow can rewrite the list without dropping the
  // `content` field or other tags, and so we can detect a failed re-fetch
  // before publishing a destructive (near-empty) replacement.
  private lastContactListEvent: NDKEvent | null = null;

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
      const relays = settings?.relays && settings.relays.length > 0
        ? settings.relays
        : this.defaultRelays;

      this.lastContactListEvent = null;

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

      // `connect(timeout)` resolves once relays have been *asked* to connect,
      // but the WebSocket handshakes complete asynchronously. Without waiting
      // for at least one relay to actually reach CONNECTED, the first
      // fetchEvents/fetchProfile races ahead and returns empty — which is the
      // classic "Nostr doesn't work / no contacts" symptom.
      await this.ndk.connect(3000);
      const ready = await this.waitForRelays(3000);

      this.isConnected = true;
      console.log(
        `NostrService: Connected to Nostr network (relays ready: ${ready})`,
      );
      return true;
    } catch (error) {
      console.error('NostrService: Failed to initialize:', error);
      return false;
    }
  }

  /**
   * Resolve once at least one relay reaches the CONNECTED state, or when the
   * timeout elapses. Returns whether any relay is connected.
   */
  private async waitForRelays(timeoutMs = 3000): Promise<boolean> {
    if (!this.ndk) return false;

    const anyConnected = () =>
      Array.from(this.ndk!.pool.relays.values()).some(r => r.connected);

    if (anyConnected()) return true;

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (anyConnected()) return true;
    }
    return anyConnected();
  }

  /**
   * Guard used before any read/write that touches relays. Ensures NDK exists,
   * (re)connects if every relay has dropped, and waits for connectivity. Throws
   * when no relay can be reached so callers never operate against a dead pool —
   * critical for follow-list writes, which would otherwise publish a
   * destructive (empty) replacement.
   */
  private async ensureReady(timeoutMs = 3000): Promise<void> {
    if (!this.ndk) {
      throw new Error('Nostr is not initialized');
    }

    const hasConnected = Array.from(this.ndk.pool.relays.values()).some(
      r => r.connected,
    );
    if (!hasConnected) {
      await this.ndk.connect(timeoutMs);
    }

    const ready = await this.waitForRelays(timeoutMs);
    if (!ready) {
      throw new Error('No Nostr relay is reachable');
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
      const input = normalizeNostrPrivateKeyInput(nsecOrPrivateKey);
      const lowerInput = input.toLowerCase();

      if (lowerInput.startsWith('nsec')) {
        const { type, data } = nip19.decode(input);
        if (type !== 'nsec') throw new Error('Invalid nsec format');
        privateKeyBytes = data as Uint8Array;
      } else if (lowerInput.startsWith('npriv')) {
        privateKeyBytes = decodeNpriv(input);
      } else {
        // Validate hex format
        if (!/^[0-9a-f]{64}$/i.test(input)) {
          throw new Error('Invalid private key format');
        }
        privateKeyBytes = utils.hexToBytes(input.toLowerCase());
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

  /**
   * Derive a Nostr key pair deterministically from a BIP39 wallet mnemonic
   * following NIP-06 (path m/44'/1237'/<account>'/0/0). This lets the user's
   * Nostr identity be backed up by the same seed as their wallet — matching
   * the browser extension's behaviour.
   */
  deriveKeysFromMnemonic(
    mnemonic: string,
    account = 0,
  ): { privateKey: string; publicKey: string; nsec: string; npub: string } | null {
    try {
      const trimmed = (mnemonic || '').trim();
      if (!trimmed) throw new Error('Mnemonic is required');

      const seed = mnemonicToSeedSync(trimmed);
      const root = HDKey.fromMasterSeed(seed);
      const child = root.derive(NOSTR_DERIVATION_PATH(account));
      if (!child.privateKey) throw new Error('Failed to derive private key');

      const privateKeyBytes = child.privateKey;
      const privateKey = utils.bytesToHex(privateKeyBytes);
      const publicKey = getPublicKey(privateKeyBytes);
      const nsec = nip19.nsecEncode(privateKeyBytes);
      const npub = nip19.npubEncode(publicKey);

      return { privateKey, publicKey, nsec, npub };
    } catch (error) {
      console.error('NostrService: Failed to derive keys from mnemonic:', error);
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
      // `relay.connected` is the supported boolean accessor. The previous code
      // compared the raw status to `1`, but in NDK's NDKRelayStatus enum
      // 1 = DISCONNECTED and 5 = CONNECTED, so every relay was reported offline.
      return relays.map(relay => ({
        url: relay.url,
        connected: relay.connected,
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
      await this.ensureReady();

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

  /**
   * Fetch the user's most recent kind-3 (NIP-02) follow-list event from the
   * relays. Caches it in `lastContactListEvent` so subsequent follow/unfollow
   * writes can preserve its `content` and tags. `closeOnEose` ensures the
   * request resolves promptly instead of hanging on a long-lived subscription.
   */
  private async fetchContactListEvent(): Promise<NDKEvent | null> {
    if (!this.ndk || !this.user) {
      throw new Error('NDK or user not initialized');
    }

    const filter: NDKFilter = {
      kinds: [3],
      authors: [this.user.pubkey],
      limit: 1,
    };

    const event = await this.ndk.fetchEvent(filter, { closeOnEose: true });
    if (event) {
      // Keep the newest event only (fetchEvent already returns the latest).
      this.lastContactListEvent = event;
    }
    return event;
  }

  private parseContactsFromEvent(event: NDKEvent): NostrContact[] {
    const contacts: NostrContact[] = [];
    for (const tag of event.tags) {
      if (tag[0] === 'p' && tag[1]) {
        contacts.push({
          pubkey: tag[1],
          relay: tag[2] || undefined,
          petname: tag[3] || undefined,
        });
      }
    }
    return contacts;
  }

  // Get contact list (following list, NIP-02 kind 3)
  async getContactList(): Promise<NostrContact[]> {
    try {
      if (!this.ndk || !this.user) {
        throw new Error('NDK or user not initialized');
      }
      await this.ensureReady();

      const contactListEvent = await this.fetchContactListEvent();

      if (!contactListEvent) {
        console.log('NostrService: No contact list found');
        return [];
      }

      const contacts = this.parseContactsFromEvent(contactListEvent);

      // Fetch profiles for contacts
      await this.fetchContactProfiles(contacts);

      return contacts;
    } catch (error) {
      console.error('NostrService: Failed to get contact list:', error);
      throw error instanceof Error ? error : new Error('Failed to get contact list');
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

      const profileEvents = await this.ndk.fetchEvents(filter, { closeOnEose: true });

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

  /**
   * Publish an updated kind-3 follow list (NIP-02), preserving the existing
   * event's `content` (which may hold a NIP-65-style relay map) and any
   * non-`p` tags. `event.publish()` returns the set of relays that accepted
   * the event; an empty set means nothing was stored, so we treat that as a
   * failure rather than reporting a phantom success.
   */
  private async publishContactTags(
    pTags: string[][],
    content: string,
  ): Promise<boolean> {
    if (!this.ndk) throw new Error('NDK not initialized');

    const event = new NDKEvent(this.ndk);
    event.kind = NDKKind.Contacts; // kind 3
    event.tags = pTags;
    event.content = content;

    const publishedTo = await event.publish();
    if (publishedTo.size === 0) {
      throw new Error('No relay accepted the contact list update');
    }

    // Cache so the next follow/unfollow builds on the freshly published list.
    event.created_at = event.created_at || Math.floor(Date.now() / 1000);
    this.lastContactListEvent = event;
    return true;
  }

  // Follow a user (append to the NIP-02 kind-3 follow list)
  async followUser(pubkey: string, relay?: string, petname?: string): Promise<boolean> {
    try {
      if (!this.ndk || !this.user) {
        throw new Error('NDK or user not initialized');
      }
      await this.ensureReady();

      // Always re-fetch the latest list so we never clobber follows added from
      // another client. ensureReady() guarantees relays are reachable, so a
      // null result here means the user genuinely has no list yet (safe to
      // create one) rather than a transient fetch failure that would wipe it.
      const existing = await this.fetchContactListEvent();
      const existingTags = existing ? [...existing.tags] : [];
      const content = existing?.content ?? '';

      // Already following? Nothing to do.
      if (existingTags.some(t => t[0] === 'p' && t[1] === pubkey)) {
        console.log('NostrService: Already following user');
        return true;
      }

      // NIP-02 p-tag shape: ['p', <pubkey>, <relay hint>, <petname>].
      // The relay slot must be present (even if empty) when a petname follows.
      const newTag = ['p', pubkey];
      if (relay || petname) newTag.push(relay || '');
      if (petname) newTag.push(petname);

      const ok = await this.publishContactTags([...existingTags, newTag], content);
      if (ok) console.log('NostrService: Successfully followed user');
      return ok;
    } catch (error) {
      console.error('NostrService: Failed to follow user:', error);
      return false;
    }
  }

  // Unfollow a user (remove from the NIP-02 kind-3 follow list)
  async unfollowUser(pubkey: string): Promise<boolean> {
    try {
      if (!this.ndk || !this.user) {
        throw new Error('NDK or user not initialized');
      }
      await this.ensureReady();

      const existing = await this.fetchContactListEvent();

      // No list on the relays means there is nothing to unfollow. Publishing an
      // empty kind-3 here would be a destructive no-op, so bail out instead.
      if (!existing) {
        console.log('NostrService: No contact list to unfollow from');
        return true;
      }

      const wasFollowing = existing.tags.some(
        t => t[0] === 'p' && t[1] === pubkey,
      );
      if (!wasFollowing) {
        return true;
      }

      const updatedTags = existing.tags.filter(
        t => !(t[0] === 'p' && t[1] === pubkey),
      );

      const ok = await this.publishContactTags(updatedTags, existing.content ?? '');
      if (ok) console.log('NostrService: Successfully unfollowed user');
      return ok;
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
      // Relays may deliver an older replaceable event after a newer one; keep
      // only the most recent so a stale copy can't roll the follow list back.
      const prev = this.lastContactListEvent;
      if (prev && (event.created_at ?? 0) < (prev.created_at ?? 0)) {
        return;
      }
      this.lastContactListEvent = event;

      const contacts = this.parseContactsFromEvent(event);
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
      await this.ensureReady();

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

  /**
   * Resolve any of the common contact identifiers users paste in — npub1…,
   * nprofile1…, a 64-char hex pubkey, or a NIP-05 address (name@domain) — to a
   * hex pubkey. Returning a structured error lets the UI explain *why* an entry
   * was rejected instead of a generic "invalid pubkey".
   */
  async resolveToPubkey(
    input: string,
  ): Promise<{ pubkey: string } | { error: string }> {
    const trimmed = (input || '').trim().replace(/^nostr:/i, '');
    if (!trimmed) return { error: 'Enter an npub, hex key, or name@domain.' };

    // NIP-19 bech32 entities (npub / nprofile).
    if (/^(npub|nprofile)1[0-9a-z]+$/i.test(trimmed)) {
      try {
        const decoded = nip19.decode(trimmed);
        if (decoded.type === 'npub') return { pubkey: decoded.data as string };
        if (decoded.type === 'nprofile') {
          return { pubkey: (decoded.data as { pubkey: string }).pubkey };
        }
        return { error: 'Unsupported Nostr entity.' };
      } catch {
        return { error: 'Invalid npub/nprofile.' };
      }
    }

    // Raw hex pubkey.
    if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      return { pubkey: trimmed.toLowerCase() };
    }

    // NIP-05 address (name@domain or _@domain / bare domain).
    if (/^[^@\s]*@?[^@\s]+\.[^@\s]+$/.test(trimmed) && trimmed.includes('.')) {
      try {
        if (!this.ndk) throw new Error('not initialized');
        await this.ensureReady();
        const nip05 = trimmed.includes('@') ? trimmed : `_@${trimmed}`;
        const user = await this.ndk.getUserFromNip05(nip05);
        if (user?.pubkey) return { pubkey: user.pubkey };
        return { error: `Could not resolve NIP-05 address "${trimmed}".` };
      } catch {
        return { error: `Could not resolve NIP-05 address "${trimmed}".` };
      }
    }

    return { error: 'Unrecognised format. Use npub1…, a hex key, or name@domain.' };
  }

  /**
   * Read the user's NIP-65 relay list (kind 10002). This is the modern,
   * relay-portable way to manage which relays a user publishes to / reads from,
   * superseding stuffing relay data into the kind-3 content field. Falls back
   * to deriving relays from a legacy kind-3 list when no kind 10002 exists.
   */
  async getRelayListMetadata(
    pubkey?: string,
  ): Promise<{ url: string; read: boolean; write: boolean }[]> {
    try {
      if (!this.ndk) throw new Error('NDK not initialized');
      const author = pubkey || this.user?.pubkey;
      if (!author) throw new Error('No pubkey available');
      await this.ensureReady();

      const event = await this.ndk.fetchEvent(
        { kinds: [NDKKind.RelayList], authors: [author], limit: 1 },
        { closeOnEose: true },
      );
      if (!event) return [];

      const relays: { url: string; read: boolean; write: boolean }[] = [];
      for (const tag of event.tags) {
        if (tag[0] !== 'r' || !tag[1]) continue;
        const marker = tag[2]; // 'read' | 'write' | undefined (= both)
        relays.push({
          url: tag[1],
          read: !marker || marker === 'read',
          write: !marker || marker === 'write',
        });
      }
      return relays;
    } catch (error) {
      console.error('NostrService: Failed to get relay list (NIP-65):', error);
      return [];
    }
  }

  /**
   * Publish the user's NIP-65 relay list (kind 10002) so other clients and the
   * outbox model know where to find them.
   */
  async publishRelayList(
    relays: { url: string; read?: boolean; write?: boolean }[],
  ): Promise<boolean> {
    try {
      if (!this.ndk || !this.user) throw new Error('NDK or user not initialized');
      await this.ensureReady();

      const event = new NDKEvent(this.ndk);
      event.kind = NDKKind.RelayList; // kind 10002
      event.tags = relays.map(({ url, read = true, write = true }) => {
        const tag = ['r', url];
        // Omit the marker when both read & write (NIP-65 default); otherwise
        // emit the single applicable marker.
        if (read && !write) tag.push('read');
        else if (write && !read) tag.push('write');
        return tag;
      });

      const publishedTo = await event.publish();
      return publishedTo.size > 0;
    } catch (error) {
      console.error('NostrService: Failed to publish relay list (NIP-65):', error);
      return false;
    }
  }

  // ── NIP-57 Lightning Zaps ──────────────────────────────────────────────

  /** Fetch JSON with a hard timeout so a slow LNURL endpoint can't hang the UI. */
  private async fetchJsonWithTimeout(url: string, timeoutMs = 10000): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`Lightning service returned ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Resolve a recipient's NIP-57 zap endpoint from their profile (lud16/lud06).
   * Returns the LNURL-pay spec, including whether the endpoint supports Nostr
   * zaps (`allowsNostr`) and the zapper pubkey that will publish receipts.
   */
  async getZapEndpoint(pubkey: string): Promise<NDKLnUrlData | null> {
    if (!this.ndk) throw new Error('Nostr is not initialized');
    await this.ensureReady();

    const user = this.ndk.getUser({ pubkey });
    const profile = await user.fetchProfile();
    const lud16 = profile?.lud16;
    const lud06 = profile?.lud06;
    if (!lud16 && !lud06) return null;

    return (await getNip57ZapSpecFromLud({ lud06, lud16 }, this.ndk)) ?? null;
  }

  /**
   * Build a zap-tagged BOLT11 invoice for a recipient (NIP-57). The caller pays
   * the returned invoice with the wallet's Lightning adapter; once paid, the
   * recipient's LNURL provider publishes a kind-9735 zap receipt so the zap
   * shows up publicly on Nostr.
   *
   * Falls back to a plain LNURL-pay invoice (no `nostr` param, so it is a
   * private payment rather than a public zap) when the endpoint or the local
   * signer can't produce a zap request — the payment still goes through.
   */
  async requestZapInvoice(params: {
    pubkey: string;
    amountSats: number;
    comment?: string;
  }): Promise<
    | { invoice: string; isZap: boolean; zapRequest?: NDKEvent }
    | { error: string }
  > {
    const { pubkey, amountSats, comment } = params;
    try {
      if (!this.ndk) throw new Error('Nostr is not initialized');
      if (!Number.isFinite(amountSats) || amountSats <= 0) {
        return { error: 'Enter an amount greater than zero.' };
      }
      await this.ensureReady();

      const zapSpec = await this.getZapEndpoint(pubkey);
      if (!zapSpec) {
        return { error: 'This contact has no Lightning address to zap.' };
      }

      const msat = Math.round(amountSats) * 1000;
      if (zapSpec.minSendable && msat < zapSpec.minSendable) {
        return { error: `Minimum is ${Math.ceil(zapSpec.minSendable / 1000)} sats.` };
      }
      if (zapSpec.maxSendable && msat > zapSpec.maxSendable) {
        return { error: `Maximum is ${Math.floor(zapSpec.maxSendable / 1000)} sats.` };
      }

      const maxComment = zapSpec.commentAllowed ?? 0;
      const trimmedComment = maxComment > 0 ? (comment || '').slice(0, maxComment) : '';

      const user = this.ndk.getUser({ pubkey });
      const sep = zapSpec.callback.includes('?') ? '&' : '?';
      let callbackUrl = `${zapSpec.callback}${sep}amount=${msat}`;
      let zapRequest: NDKEvent | undefined;

      // Real NIP-57 zap when the endpoint advertises support and we can sign.
      if (zapSpec.allowsNostr && this.signer) {
        const relays = await this.getRelays();
        const req = await generateZapRequest(
          user,
          this.ndk,
          zapSpec,
          pubkey,
          msat,
          relays,
          trimmedComment || undefined,
        );
        if (req) {
          zapRequest = req;
          const raw = req.rawEvent();
          callbackUrl += `&nostr=${encodeURIComponent(JSON.stringify(raw))}`;
        }
      }

      if (trimmedComment) {
        callbackUrl += `&comment=${encodeURIComponent(trimmedComment)}`;
      }

      const inv = await this.fetchJsonWithTimeout(callbackUrl);
      if (inv?.status === 'ERROR') {
        return { error: inv.reason || 'The Lightning service rejected the request.' };
      }
      if (!inv?.pr) {
        return { error: 'No invoice was returned for the zap.' };
      }

      return { invoice: String(inv.pr), isZap: !!zapRequest, zapRequest };
    } catch (error: any) {
      console.error('NostrService: Failed to create zap invoice:', error);
      return { error: error?.message || 'Failed to create the zap.' };
    }
  }

  /**
   * Plain LNURL-pay for a Lightning address (user@domain) — no Nostr identity
   * or relay connection required. Used to pay contacts that only have a
   * Lightning address (not a real zap, since there is no recipient pubkey).
   */
  async requestLnurlPayInvoice(params: {
    lightningAddress: string;
    amountSats: number;
    comment?: string;
  }): Promise<{ invoice: string } | { error: string }> {
    const { lightningAddress, amountSats, comment } = params;
    try {
      const [username, domain] = lightningAddress.trim().split('@');
      if (!username || !domain) {
        return { error: `That doesn't look like a Lightning address.` };
      }
      if (!Number.isFinite(amountSats) || amountSats <= 0) {
        return { error: 'Enter an amount greater than zero.' };
      }

      const lnurl = await this.fetchJsonWithTimeout(
        `https://${domain}/.well-known/lnurlp/${username}`,
      );
      if (lnurl?.status === 'ERROR') {
        return { error: lnurl.reason || 'Lightning address rejected the request.' };
      }

      const msat = Math.round(amountSats) * 1000;
      if (lnurl?.minSendable && msat < lnurl.minSendable) {
        return { error: `Minimum is ${Math.ceil(lnurl.minSendable / 1000)} sats.` };
      }
      if (lnurl?.maxSendable && msat > lnurl.maxSendable) {
        return { error: `Maximum is ${Math.floor(lnurl.maxSendable / 1000)} sats.` };
      }

      const maxComment = lnurl?.commentAllowed ?? 0;
      const trimmedComment = maxComment > 0 ? (comment || '').slice(0, maxComment) : '';
      const sep = String(lnurl.callback).includes('?') ? '&' : '?';
      let callbackUrl = `${lnurl.callback}${sep}amount=${msat}`;
      if (trimmedComment) callbackUrl += `&comment=${encodeURIComponent(trimmedComment)}`;

      const inv = await this.fetchJsonWithTimeout(callbackUrl);
      if (inv?.status === 'ERROR') {
        return { error: inv.reason || 'Could not get an invoice.' };
      }
      if (!inv?.pr) return { error: 'No invoice was returned.' };
      return { invoice: String(inv.pr) };
    } catch (error: any) {
      console.error('NostrService: LNURL-pay failed:', error);
      return { error: error?.message || 'Failed to fetch a Lightning invoice.' };
    }
  }

  // ── Encrypted Direct Messages (NIP-17 gift wrap, NIP-04/44 legacy) ─────────

  /** The signing key as hex, or throw when the Nostr identity is locked. */
  private getPrivateKeyHex(): string {
    const sk = this.signer?.privateKey;
    if (!sk) throw new Error('Nostr identity is locked');
    return sk;
  }

  /** Encrypt a plaintext message to `recipientPubkey` with a legacy scheme. */
  private async encryptDM(
    recipientPubkey: string,
    plaintext: string,
    scheme: 'nip04' | 'nip44',
  ): Promise<string> {
    const sk = this.getPrivateKeyHex();
    if (scheme === 'nip44') {
      const key = nip44.getConversationKey(utils.hexToBytes(sk), recipientPubkey);
      return nip44.encrypt(plaintext, key);
    }
    return nip04.encrypt(sk, recipientPubkey, plaintext);
  }

  /**
   * Decrypt a legacy kind-4 payload from/for `counterpartyPubkey`. NIP-04
   * ciphertext always carries a `?iv=` suffix; NIP-44 (versioned base64) never
   * does, which lets us auto-detect the scheme. Falls back to NIP-04 if a NIP-44
   * attempt fails on an unexpected payload shape.
   */
  private async decryptDM(
    counterpartyPubkey: string,
    content: string,
  ): Promise<{ text: string; scheme: 'nip04' | 'nip44' }> {
    const sk = this.getPrivateKeyHex();
    if (content.includes('?iv=')) {
      return { text: await nip04.decrypt(sk, counterpartyPubkey, content), scheme: 'nip04' };
    }
    try {
      const key = nip44.getConversationKey(utils.hexToBytes(sk), counterpartyPubkey);
      return { text: nip44.decrypt(content, key), scheme: 'nip44' };
    } catch {
      return { text: await nip04.decrypt(sk, counterpartyPubkey, content), scheme: 'nip04' };
    }
  }

  /** Decrypt a raw kind-4 event into a DirectMessage relative to the current user. */
  private async decryptEvent(event: NDKEvent): Promise<DirectMessage | null> {
    try {
      const me = this.user?.pubkey;
      if (!me) return null;
      const mine = event.pubkey === me;
      const recipient = event.tags.find(t => t[0] === 'p')?.[1] || '';
      // The other side of the conversation: the recipient for messages we sent,
      // the author for messages we received. ECDH is symmetric so either works
      // as the decryption counterparty.
      const counterparty = mine ? recipient : event.pubkey;
      if (!counterparty) return null;

      const { text, scheme } = await this.decryptDM(counterparty, event.content);
      return {
        id: event.id,
        pubkey: event.pubkey,
        recipient: recipient || me,
        content: text,
        createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
        mine,
        scheme,
      };
    } catch (error) {
      console.warn('NostrService: failed to decrypt DM', event.id, error);
      return null;
    }
  }

  // ── NIP-17 helpers ─────────────────────────────────────────────────────────

  /**
   * Unwrap a kind-1059 gift wrap into its inner kind-14 rumor (the real message).
   * Returns null when the wrap isn't addressed to us / can't be decrypted, so a
   * stranger's or malformed wrap is silently skipped.
   */
  private unwrapGift(event: NDKEvent): any | null {
    try {
      const skBytes = utils.hexToBytes(this.getPrivateKeyHex());
      const raw = typeof event.rawEvent === 'function' ? event.rawEvent() : event;
      return nip17.unwrapEvent(raw as any, skBytes);
    } catch {
      return null;
    }
  }

  /** Convert an unwrapped kind-14 rumor into a DirectMessage for the current user. */
  private rumorToDirectMessage(rumor: any): DirectMessage | null {
    const me = this.user?.pubkey;
    if (!me || !rumor?.id) return null;
    const mine = rumor.pubkey === me;
    const tags: string[][] = rumor.tags || [];
    const pTag = tags.find((t) => t[0] === 'p')?.[1];
    const recipient = pTag || (mine ? '' : me);
    return {
      id: rumor.id,
      pubkey: rumor.pubkey,
      recipient: recipient || me,
      content: rumor.content,
      createdAt: rumor.created_at,
      mine,
      scheme: 'nip17',
      ...this.parsePaymentTags(tags),
    };
  }

  /**
   * Parse the payment-request / receipt tags defined by the KaleidoSwap payment
   * NIP (docs/nip-payment-requests.md) from a kind-14 rumor's tags.
   */
  private parsePaymentTags(
    tags: string[][],
  ): { payment?: ChatPaymentRequest; receipt?: ChatPaymentReceipt } {
    const val = (name: string) => tags.find((t) => t[0] === name)?.[1];
    const paymentTag = tags.find((t) => t[0] === 'payment');
    if (!paymentTag) return {};

    if (paymentTag[1] === 'request') {
      const assetTag = tags.find((t) => t[0] === 'asset');
      const amount = val('amount');
      const expiry = val('expiry');
      return {
        payment: {
          requestId: paymentTag[2] || undefined,
          invoice: val('bolt11') || '',
          amountMsat: amount ? Number(amount) : undefined,
          description: val('description') || undefined,
          expiry: expiry ? Number(expiry) : undefined,
          asset: assetTag
            ? {
                id: assetTag[1],
                ticker: assetTag[2] || undefined,
                precision: assetTag[3] ? Number(assetTag[3]) : undefined,
                amount: assetTag[4] ? Number(assetTag[4]) : undefined,
              }
            : undefined,
        },
      };
    }

    if (paymentTag[1] === 'receipt') {
      const status = (val('status') as ChatPaymentReceipt['status']) || 'paid';
      return {
        receipt: {
          requestId: paymentTag[2] || undefined,
          status,
          preimage: val('preimage') || undefined,
        },
      };
    }
    return {};
  }

  /** Publish a pre-signed raw event (e.g. a gift wrap signed by a throwaway key)
   *  without letting NDK re-sign it. Returns the number of relays that accepted. */
  private async publishRawEvent(raw: any): Promise<number> {
    if (!this.ndk) throw new Error('Nostr is not initialized');
    const event = new NDKEvent(this.ndk, raw);
    const publishedTo = await event.publish();
    return publishedTo.size;
  }

  /**
   * Send a NIP-17 gift-wrapped private DM (kind 14 → seal 13 → gift wrap 1059)
   * with optional extra tags (used to carry structured payment requests/receipts).
   */
  private async sendGiftWrappedRumor(
    recipientPubkey: string,
    content: string,
    extraTags: string[][] = [],
  ): Promise<DirectMessage> {
    const me = this.user!.pubkey;
    const skBytes = utils.hexToBytes(this.getPrivateKeyHex());

    // Build the unsigned kind-14 rumor (its id is what we key the message on).
    const rumor = nip59.createRumor(
      {
        kind: PRIVATE_DM_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', recipientPubkey], ...extraTags],
        content,
      } as any,
      skBytes,
    );

    // Gift-wrap to the recipient AND to ourselves, so our own sent messages are
    // retrievable from the relays (NIP-17 §"the sender's own messages").
    const targets = recipientPubkey === me ? [recipientPubkey] : [recipientPubkey, me];
    let accepted = 0;
    for (const target of targets) {
      const seal = nip59.createSeal(rumor, skBytes, target);
      const wrap = nip59.createWrap(seal, target);
      accepted += await this.publishRawEvent(wrap);
    }
    if (accepted === 0) throw new Error('No relay accepted the message');

    const message = this.rumorToDirectMessage(rumor);
    if (!message) throw new Error('Failed to build the message');
    return message;
  }

  /** Send a legacy kind-4 DM encrypted with NIP-04 or NIP-44. */
  private async sendLegacyDM(
    recipientPubkey: string,
    text: string,
    scheme: 'nip04' | 'nip44',
  ): Promise<DirectMessage> {
    const event = new NDKEvent(this.ndk!);
    event.kind = DM_KIND;
    event.content = await this.encryptDM(recipientPubkey, text, scheme);
    event.tags = [['p', recipientPubkey]];

    const publishedTo = await event.publish();
    if (publishedTo.size === 0) {
      throw new Error('No relay accepted the message');
    }

    return {
      id: event.id,
      pubkey: this.user!.pubkey,
      recipient: recipientPubkey,
      content: text,
      createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
      mine: true,
      scheme,
    };
  }

  /**
   * Send an encrypted direct message to `recipientPubkey`. NIP-17 (default) uses
   * gift wrapping; nip44/nip04 fall back to a legacy kind-4 event. Resolves once
   * at least one relay has accepted, returning the local DirectMessage.
   */
  async sendDirectMessage(
    recipientPubkey: string,
    text: string,
    scheme: DMScheme = 'nip17',
  ): Promise<DirectMessage> {
    if (!this.ndk || !this.user) throw new Error('Nostr is not initialized');
    if (!this.signer) throw new Error('Nostr identity is locked');
    await this.ensureReady();

    return scheme === 'nip17'
      ? this.sendGiftWrappedRumor(recipientPubkey, text)
      : this.sendLegacyDM(recipientPubkey, text, scheme);
  }

  /**
   * Send a structured payment request (see docs/nip-payment-requests.md). Under
   * NIP-17 the request is carried as tags on the gift-wrapped rumor so the UI can
   * render a rich, stateful card; under legacy schemes it degrades to a plain
   * message containing the invoice (still detectable + payable by any client).
   */
  async sendPaymentRequest(
    recipientPubkey: string,
    req: ChatPaymentRequest,
    scheme: DMScheme = 'nip17',
  ): Promise<DirectMessage> {
    if (!this.ndk || !this.user) throw new Error('Nostr is not initialized');
    if (!this.signer) throw new Error('Nostr identity is locked');
    await this.ensureReady();

    const summary = req.asset?.amount != null
      ? `${req.asset.amount} ${req.asset.ticker || 'asset'}`
      : req.amountMsat
        ? `${Math.round(req.amountMsat / 1000).toLocaleString()} sats`
        : '';
    const lines = [`⚡ Payment request${summary ? ` — ${summary}` : ''}`];
    if (req.description) lines.push(req.description);
    lines.push(req.invoice);
    const content = lines.join('\n');

    if (scheme !== 'nip17') {
      return this.sendLegacyDM(recipientPubkey, content, scheme);
    }

    const tags: string[][] = [
      ['payment', 'request', req.requestId || ''],
      ['bolt11', req.invoice],
      ['subject', 'Payment request'],
    ];
    if (req.amountMsat != null) tags.push(['amount', String(req.amountMsat)]);
    if (req.expiry != null) tags.push(['expiry', String(req.expiry)]);
    if (req.description) tags.push(['description', req.description]);
    if (req.asset) {
      tags.push([
        'asset',
        req.asset.id,
        req.asset.ticker || '',
        String(req.asset.precision ?? 0),
        req.asset.amount != null ? String(req.asset.amount) : '',
      ]);
    }
    return this.sendGiftWrappedRumor(recipientPubkey, content, tags);
  }

  /** Send a payment receipt correlated to a prior request's `requestId`. */
  async sendPaymentReceipt(
    recipientPubkey: string,
    receipt: ChatPaymentReceipt,
    scheme: DMScheme = 'nip17',
  ): Promise<DirectMessage> {
    if (!this.ndk || !this.user) throw new Error('Nostr is not initialized');
    if (!this.signer) throw new Error('Nostr identity is locked');
    await this.ensureReady();

    const content =
      receipt.status === 'paid' ? '✅ Paid' : receipt.status === 'declined' ? '🚫 Declined' : '⌛ Expired';

    if (scheme !== 'nip17') {
      return this.sendLegacyDM(recipientPubkey, content, scheme);
    }

    const tags: string[][] = [
      ['payment', 'receipt', receipt.requestId || ''],
      ['status', receipt.status],
    ];
    if (receipt.preimage) tags.push(['preimage', receipt.preimage]);
    return this.sendGiftWrappedRumor(recipientPubkey, content, tags);
  }

  /**
   * Fetch the message history exchanged with `otherPubkey`, across both NIP-17
   * gift wraps and legacy kind-4 DMs, decrypted, de-duplicated and sorted
   * oldest-first. Gift wraps can't be filtered by counterparty at the relay
   * (the wrap author is a throwaway key and the sender is hidden), so the whole
   * gift-wrap inbox is fetched and filtered after unwrapping.
   */
  async fetchConversation(otherPubkey: string, limit = 100): Promise<DirectMessage[]> {
    if (!this.ndk || !this.user) throw new Error('Nostr is not initialized');
    await this.ensureReady();

    const me = this.user.pubkey;
    const byId = new Map<string, DirectMessage>();

    // Legacy kind-4 DMs in both directions.
    const legacyFilters: NDKFilter[] = [
      { kinds: [DM_KIND], authors: [me], '#p': [otherPubkey], limit },
      { kinds: [DM_KIND], authors: [otherPubkey], '#p': [me], limit },
    ];
    const legacyEvents = await this.ndk.fetchEvents(legacyFilters, { closeOnEose: true });
    for (const event of legacyEvents) {
      const message = await this.decryptEvent(event);
      if (message) byId.set(message.id, message);
    }

    // NIP-17 gift wraps addressed to us, filtered to this conversation.
    const giftEvents = await this.ndk.fetchEvents(
      { kinds: [GIFT_WRAP_KIND], '#p': [me], limit: Math.max(limit, 200) },
      { closeOnEose: true },
    );
    for (const event of giftEvents) {
      const rumor = this.unwrapGift(event);
      if (!rumor || rumor.kind !== PRIVATE_DM_KIND) continue;
      const message = this.rumorToDirectMessage(rumor);
      if (!message) continue;
      const counterparty = message.mine ? message.recipient : message.pubkey;
      if (counterparty === otherPubkey) byId.set(message.id, message);
    }

    return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Live-subscribe to the conversation with `otherPubkey`. Fires `onMessage` for
   * every new message in either direction — NIP-17 gift wraps (kind 1059) and
   * legacy kind-4 DMs alike. Returns a subscription id to pass to `unsubscribe`.
   */
  subscribeToConversation(
    otherPubkey: string,
    onMessage: (message: DirectMessage) => void,
  ): string {
    if (!this.ndk || !this.user) {
      throw new Error('Nostr is not initialized');
    }

    const me = this.user.pubkey;
    const subscriptionId = `dm_${otherPubkey}_${Date.now()}`;
    const filters: NDKFilter[] = [
      { kinds: [DM_KIND], authors: [me], '#p': [otherPubkey] },
      { kinds: [DM_KIND], authors: [otherPubkey], '#p': [me] },
      { kinds: [GIFT_WRAP_KIND], '#p': [me] },
    ];

    const subscription = this.ndk.subscribe(filters, { closeOnEose: false });
    subscription.on('event', async (event: NDKEvent) => {
      if (event.kind === GIFT_WRAP_KIND) {
        const rumor = this.unwrapGift(event);
        if (!rumor || rumor.kind !== PRIVATE_DM_KIND) return;
        const message = this.rumorToDirectMessage(rumor);
        if (!message) return;
        const counterparty = message.mine ? message.recipient : message.pubkey;
        if (counterparty === otherPubkey) onMessage(message);
      } else {
        const message = await this.decryptEvent(event);
        if (message) onMessage(message);
      }
    });

    this.subscriptions.set(subscriptionId, subscription);
    return subscriptionId;
  }

  /**
   * Live-subscribe to ALL incoming direct messages addressed to the current
   * user (NIP-17 gift wraps + legacy kind-4), regardless of counterparty. Used
   * by the app-level notifier to surface new messages and keep unread counts.
   * The callback receives every decrypted message, including the user's own
   * (via NIP-17 self-wraps); callers should filter on `message.mine`.
   */
  subscribeToInbox(onMessage: (message: DirectMessage) => void): string {
    if (!this.ndk || !this.user) {
      throw new Error('Nostr is not initialized');
    }

    const me = this.user.pubkey;
    const subscriptionId = `dm_inbox_${Date.now()}`;
    const filters: NDKFilter[] = [
      { kinds: [GIFT_WRAP_KIND], '#p': [me] },
      { kinds: [DM_KIND], '#p': [me] },
    ];

    const subscription = this.ndk.subscribe(filters, { closeOnEose: false });
    subscription.on('event', async (event: NDKEvent) => {
      if (event.kind === GIFT_WRAP_KIND) {
        const rumor = this.unwrapGift(event);
        if (!rumor || rumor.kind !== PRIVATE_DM_KIND) return;
        const message = this.rumorToDirectMessage(rumor);
        if (message) onMessage(message);
      } else {
        const message = await this.decryptEvent(event);
        if (message) onMessage(message);
      }
    });

    this.subscriptions.set(subscriptionId, subscription);
    return subscriptionId;
  }

  /** Current user's pubkey (hex), or null when no identity is loaded. */
  get myPubkey(): string | null {
    return this.user?.pubkey ?? null;
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
