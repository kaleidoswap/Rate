// types/nostr.ts

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


