import { generateSecretKey } from 'nostr-tools';
import { decode as decodeBolt11 } from 'light-bolt11-decoder';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import { secp256k1 } from '@noble/curves/secp256k1';
import { requestServer, reverseOnchainAmount } from './nostr';
import { checkReverseScript, buildClaimTx } from './htlc';
import { Esplora, ESPLORA } from './esplora';
import type { LightningPayer, ReverseSwap, SwapNetwork, SwapOffer } from './types';

/** Blocks we need between now and the timeout to get the claim confirmed (Electrum's MIN_LOCKTIME_DELTA). */
const MIN_LOCKTIME_DELTA = 60;

function bolt11(inv: string): { hash: string; sat: number } {
  const d = decodeBolt11(inv);
  const get = (name: string) => (d.sections as any[]).find(s => s.name === name)?.value;
  const msat = Number(get('amount'));
  if (!get('payment_hash') || !msat) throw new Error('swap invoice has no hash or amount');
  return { hash: String(get('payment_hash')), sat: Math.floor(msat / 1000) };
}

/** Asks `offer` for a reverse swap of `lightningSat` and checks every term it returns. */
export async function createReverseSwap(p: {
  offer: SwapOffer;
  network: SwapNetwork;
  lightningSat: number;
  destination: string;
  relays?: string[];
  esplora?: Esplora;
}): Promise<ReverseSwap> {
  const { offer } = p;
  const preimage = randomBytes(32);
  const paymentHash = bytesToHex(sha256(preimage));
  const claimPriv = secp256k1.utils.randomPrivateKey();
  const claimPubkey = bytesToHex(secp256k1.getPublicKey(claimPriv, true));
  const relays = [...new Set([...(offer.relays.length ? offer.relays : []), ...(p.relays ?? [])])];

  const r = await requestServer({
    server: offer.pubkey,
    relays,
    secretKey: generateSecretKey(),
    method: 'createswap',
    data: {
      type: 'reversesubmarine',
      pairId: 'BTC/BTC',
      invoiceAmount: p.lightningSat,
      preimageHash: paymentHash,
      claimPublicKey: claimPubkey,
    },
  });

  for (const k of ['id', 'invoice', 'lockupAddress', 'redeemScript']) if (typeof r[k] !== 'string') throw new Error(`swap reply lacks ${k}`);
  for (const k of ['timeoutBlockHeight', 'onchainAmount']) if (!Number.isInteger(r[k])) throw new Error(`swap reply lacks ${k}`);

  checkReverseScript({
    redeemScript: r.redeemScript,
    lockupAddress: r.lockupAddress,
    paymentHash,
    claimPubkey,
    timeoutBlockHeight: r.timeoutBlockHeight,
    network: p.network,
  });

  const main = bolt11(r.invoice);
  if (main.hash !== paymentHash) throw new Error('swap invoice is for another payment hash');
  let total = main.sat;
  if (r.minerFeeInvoice) {
    const fee = bolt11(r.minerFeeInvoice);
    if (fee.sat > offer.miningFee * 2) throw new Error('prepayment is larger than the offer announced');
    total += fee.sat;
  }
  if (total !== p.lightningSat) throw new Error(`swap invoices total ${total} sat, asked for ${p.lightningSat}`);
  const expected = reverseOnchainAmount(offer, p.lightningSat);
  if (r.onchainAmount < expected) throw new Error(`server locks ${r.onchainAmount} sat, offer promised ${expected}`);

  const esplora = p.esplora ?? new Esplora(ESPLORA[p.network]);
  if (r.timeoutBlockHeight - await esplora.tipHeight() <= MIN_LOCKTIME_DELTA) throw new Error('swap timeout too close');

  return {
    id: r.id,
    network: p.network,
    server: offer.pubkey,
    serverRelays: relays,
    preimage: bytesToHex(preimage),
    paymentHash,
    claimPrivkey: bytesToHex(claimPriv),
    claimPubkey,
    redeemScript: r.redeemScript,
    lockupAddress: r.lockupAddress,
    timeoutBlockHeight: r.timeoutBlockHeight,
    onchainAmount: r.onchainAmount,
    invoice: r.invoice,
    minerFeeInvoice: r.minerFeeInvoice,
    invoiceAmount: p.lightningSat,
    destination: p.destination,
  };
}

export type ReverseStage =
  | { stage: 'paying' }
  | { stage: 'waiting_lockup' }
  | { stage: 'lockup_seen'; txid: string; confirmed: boolean }
  | { stage: 'claimed'; txid: string; fee: number };

/** Pays the swap, waits for the server's lockup, and claims it to the destination. */
export async function completeReverseSwap(p: {
  swap: ReverseSwap;
  payer: LightningPayer;
  onStage?: (s: ReverseStage) => void;
  zeroConf?: boolean;
  pollMs?: number;
  timeoutMs?: number;
  esplora?: Esplora;
}): Promise<{ txid: string; fee: number }> {
  const { swap } = p;
  const esplora = p.esplora ?? new Esplora(ESPLORA[swap.network]);
  const say = p.onStage ?? (() => {});
  say({ stage: 'paying' });
  const invoices = swap.minerFeeInvoice ? [swap.invoice, swap.minerFeeInvoice] : [swap.invoice];
  // The main payment stays pending until our claim reveals the preimage, so don't await it here.
  const paying = p.payer.payInvoices(invoices);
  let payError: unknown = null;
  paying.catch(e => { payError = e; });

  say({ stage: 'waiting_lockup' });
  const deadline = Date.now() + (p.timeoutMs ?? 60 * 60 * 1000);
  let seen: { txid: string; vout: number; confirmed: boolean } | null = null;
  let announced = false;
  while (Date.now() < deadline) {
    if (payError) throw payError;
    seen = await esplora.findOutput(swap.lockupAddress, swap.onchainAmount).catch(() => null);
    if (seen && !announced) { say({ stage: 'lockup_seen', txid: seen.txid, confirmed: seen.confirmed }); announced = true; }
    if (seen && (seen.confirmed || p.zeroConf)) break;
    await new Promise(r => setTimeout(r, p.pollMs ?? 10000));
  }
  if (!seen || !(seen.confirmed || p.zeroConf)) throw new Error('server never locked the swap on-chain');

  const claim = buildClaimTx({
    txid: seen.txid,
    vout: seen.vout,
    amount: swap.onchainAmount,
    redeemScript: swap.redeemScript,
    preimage: swap.preimage,
    claimPrivkey: swap.claimPrivkey,
    destination: swap.destination,
    feeRate: await esplora.feeRate(),
    network: swap.network,
  });
  await esplora.broadcast(claim.hex);
  say({ stage: 'claimed', txid: claim.txid, fee: claim.fee });
  return { txid: claim.txid, fee: claim.fee };
}
