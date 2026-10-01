export type SwapNetwork = 'mainnet' | 'signet' | 'testnet' | 'mutinynet';

export interface SwapOffer {
  pubkey: string;
  percentageFee: number;
  miningFee: number;
  minAmount: number;
  maxForward: number;
  maxReverse: number;
  relays: string[];
  powBits: number;
  createdAt: number;
}

export interface ReverseSwap {
  id: string;
  network: SwapNetwork;
  server: string;
  serverRelays: string[];
  preimage: string;
  paymentHash: string;
  claimPrivkey: string;
  claimPubkey: string;
  redeemScript: string;
  lockupAddress: string;
  timeoutBlockHeight: number;
  onchainAmount: number;
  invoice: string;
  minerFeeInvoice?: string;
  invoiceAmount: number;
  destination: string;
}

export interface LightningPayer {
  /** Pays all invoices concurrently. Must not wait for the first to settle before
   *  sending the next: the server settles the prepayment only once both arrive. */
  payInvoices(invoices: string[]): Promise<void>;
}
