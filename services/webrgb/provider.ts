import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { ProviderErrorCode, RgbBlindReceiveArgs, RgbMethod, RgbTransfer } from '@utexo/webrgb';
import type { WalletConnectBackend, WalletConnectWalletContext } from '@utexo/webrgb-walletconnect';
import type { Balance, BitcoinNetwork, InvoiceData } from '../../modules/kaleido-rgb';
import { formatAssetAmount } from '../../utils/assetAmount';
import type { RgbLibRnAccount } from '../protocols/rgbLibRn';
import { validateSignMessage } from './message';
import { getReceivedMint, supportsReceivedMint } from './mint';

const BASE_METHODS: RgbMethod[] = [
  'enable', 'getInfo', 'getAddress', 'getBtcBalance', 'listAssets',
  'getAssetBalance', 'blindReceive', 'witnessReceive', 'sendAsset', 'decodeRgbInvoice',
  'listTransfers', 'getTransferStatus', 'refresh',
];

export function webRgbMethods(account: RgbLibRnAccount): RgbMethod[] {
  const methods = [...BASE_METHODS];
  if (account.supportsUtxoReview()) methods.push('createUtxos');
  if (account.signMessage) methods.push('signMessage');
  if (supportsReceivedMint(account)) methods.push('getReceivedMint');
  return methods;
}

function failure(code: ProviderErrorCode, message: string) {
  return Object.assign(new Error(message), { code });
}

function invalid(message: string): never { throw failure('INVALID_PARAMS', message); }

function fields(value: unknown, keys: string[]): void {
  if (value == null || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key))) invalid('Unexpected WebRGB request parameters.');
}

function text(value: unknown, name: string, max = 1024): string {
  if (typeof value !== 'string' || !value || value.length > max || /[\s\p{Cc}]/u.test(value)) {
    invalid('Invalid ' + name + '.');
  }
  return value;
}

function integer(value: number, name: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid('Invalid ' + name + '.');
  return value;
}

function fee(value: unknown): number {
  if (value === undefined) return 2;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) invalid('Invalid fee rate.');
  // The native ABI accepts integer sat/vB. Review and submit the very same rate.
  return integer(Math.ceil(value), 'fee rate', 1, 1000);
}

function balance(value: Balance): Balance {
  return {
    spendable: integer(value.spendable, 'spendable balance', 0),
    settled: integer(value.settled, 'settled balance', 0),
    future: integer(value.future, 'future balance', 0),
  };
}

const NETWORKS: Record<BitcoinNetwork, string> = {
  MAINNET: 'mainnet', SIGNET: 'signet', SIGNET_CUSTOM: 'mutinynet',
  TESTNET: 'testnet', TESTNET4: 'testnet4', REGTEST: 'regtest',
};

function invoiceAmount(invoice: InvoiceData): number | null {
  if (invoice.assignment.type === 'NON_FUNGIBLE') return 1;
  if (invoice.assignment.type === 'FUNGIBLE') return integer(invoice.assignment.amount, 'invoice amount', 0) || null;
  if (invoice.assignment.type === 'ANY') return null;
  return invalid('This invoice requests an asset right.');
}

function nativeError(error: unknown): never {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'ERR_RGB_INSUFFICIENT_BITCOINS') throw failure('INTERNAL_ERROR', 'Not enough bitcoin for this transaction and its mining fee.');
  if (code === 'ERR_RGB_ASSET_NOT_FOUND') throw failure('ASSET_NOT_FOUND', 'The wallet does not know this asset.');
  if (code === 'ERR_RGB_INSUFFICIENT_ALLOCATION_SLOTS' || code === 'ERR_RGB_NO_AVAILABLE_UTXOS') {
    throw failure('NO_AVAILABLE_UTXOS', 'The wallet has no available allocation slot.');
  }
  if (code === 'RGB_INVOICE_INVALID' || code?.startsWith('ERR_RGB_INVALID_')) {
    throw failure('INVALID_PARAMS', 'The RGB request is invalid or expired.');
  }
  if (code && ['NOT_ENABLED', 'USER_REJECTED', 'INVALID_PARAMS', 'ASSET_NOT_FOUND', 'NO_AVAILABLE_UTXOS', 'METHOD_NOT_SUPPORTED'].includes(code)) throw error;
  // Native exceptions can contain paths and connection details that do not belong in a dApp reply.
  throw failure('INTERNAL_ERROR', 'The RGB wallet could not complete the request. Check the wallet activity before retrying a transfer.');
}

export function createWebRgbProvider(
  account: RgbLibRnAccount, context: WalletConnectWalletContext,
  approve: (detail: string) => Promise<void>, assertActive: () => void,
): WalletConnectBackend {
  const methods = webRgbMethods(account);
  function ownedInvoiceKey(invoice: string) {
    const binding = JSON.stringify([account.ownerKey, context.network, context.origin, invoice]);
    return 'webrgb-owned-invoice-v1-' + bytesToHex(sha256(utf8ToBytes(binding)));
  }
  // Proxy v1 sends need the invoice's encryption key and deadline. A dApp can
  // decode an invoice and then use its bare recipient ID for an explicit amount.
  const invoicesByRecipient = new Map<string, string>();
  function rememberInvoice(recipient: string, invoice: string) {
    invoicesByRecipient.delete(recipient);
    if (invoicesByRecipient.size >= 64) invoicesByRecipient.delete(invoicesByRecipient.keys().next().value!);
    invoicesByRecipient.set(recipient, invoice);
  }
  const guard = () => { context.assertAuthorized(); assertActive(); };
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    guard();
    try {
      const result = await operation();
      guard();
      return result;
    } catch (error) { return nativeError(error); }
  };
  const confirm = async (detail: string) => {
    guard();
    await approve(detail);
    guard();
  };
  const assets = async () => (await account.listAssets()).nia ?? [];
  const knownAsset = async (id: string) => {
    text(id, 'asset ID');
    const asset = (await assets()).find(a => a.assetId === id);
    if (!asset) throw failure('ASSET_NOT_FOUND', 'The wallet does not know this asset.');
    return asset;
  };
  const transfers = async (assetId?: string): Promise<RgbTransfer[]> => {
    const id = assetId === undefined ? null : text(assetId, 'asset ID');
    const result: RgbTransfer[] = [];
    for (const t of await account.listTransfers(id)) {
      // Native transfer records also contain local consignment and PSBT paths.
      result.push({
        ...(id ? { assetId: id } : {}), transferId: t.batchTransferIdx,
        status: t.status, kind: t.kind, amount: t.amount,
        ...(t.recipientId ? { recipientId: t.recipientId } : {}), ...(t.txid ? { txid: t.txid } : {}),
      });
    }
    return result;
  };

  const receive = (witness: boolean, args: RgbBlindReceiveArgs = {}) => run(async () => {
    fields(args, ['assetId', 'amount', 'durationSeconds', 'minConfirmations']);
    if (args.assetId !== undefined) await knownAsset(args.assetId);
    if (args.amount !== undefined) integer(args.amount, 'amount', 1);
    if (args.durationSeconds !== undefined) integer(args.durationSeconds, 'invoice duration', 1, 0xffffffff);
    const minConfirmations = Math.max(3, integer(args.minConfirmations === undefined ? 3 : args.minConfirmations, 'confirmations', 1, 255));
    await confirm([
      witness ? 'Create a witness RGB invoice' : 'Create a blinded RGB invoice',
      'Asset: ' + (args.assetId ?? 'any RGB asset'), 'Amount: ' + (args.amount === undefined ? 'any amount' : args.amount + ' base units'),
      'Confirmations: ' + minConfirmations, 'Expires in: ' + (args.durationSeconds ?? 86400) + ' seconds',
    ].join('\n'));
    const invoice = await account.receiveAsset({ ...args, witness, minConfirmations }, guard);
    // Keep ownership across restarts, without storing the bearer invoice or the site's name.
    await AsyncStorage.setItem(ownedInvoiceKey(invoice.invoice), '1');
    rememberInvoice(invoice.recipientId, invoice.invoice);
    return { invoice: invoice.invoice, recipientId: invoice.recipientId, expirationTimestamp: invoice.expirationTimestamp, minConfirmations };
  });

  return {
    async enable() { guard(); },
    async getInfo() { guard(); return { ready: true, protocol: 'RGB_L1', network: context.network, methods }; },
    getAddress: () => run(async () => ({ address: await account.getAddress() })),
    getBtcBalance: () => run(async () => {
      const btc = await account.syncedBtcBalance();
      const unspents = await account.listUnspents();
      return {
        vanilla: balance(btc.vanilla), colored: balance(btc.colored),
        freeColorableUtxos: unspents.filter(u => u.utxo.exists && u.utxo.colorable && !u.rgbAllocations.length && u.pendingBlinded === 0).length,
      };
    }),
    createUtxos: (args = {}) => run(async () => {
      fields(args, ['num', 'size', 'feeRate']);
      const num = integer(args.num === undefined ? 5 : args.num, 'output count', 1, 255);
      const size = integer(args.size === undefined ? 1000 : args.size, 'output size', 1, 0xffffffff);
      const feeRate = fee(args.feeRate);
      const created = await account.createReviewedUtxos(num, size, feeRate, async preview => {
        const lines = preview.outputs.map(output => output.amountSat + ' sats → ' + output.address);
        await confirm([
          'Create colorable Bitcoin outputs on ' + context.network,
          'Requested: ' + num + ' × ' + size + ' sats', 'Wallet outputs (including change):', ...lines,
          'Mining fee: ' + preview.feeSat + ' sats (' + feeRate + ' sat/vB)',
        ].join('\n'));
      }, guard);
      return { created, size, feeRate };
    }),
    listAssets: () => run(async () => (await assets()).map(a => ({
      id: a.assetId, ticker: a.ticker, name: a.name, precision: a.precision, balance: balance(a.balance),
    }))),
    getAssetBalance: assetId => run(async () => {
      const raw = balance((await knownAsset(assetId)).balance);
      return { assetId, balance: raw.spendable, raw };
    }),
    blindReceive: args => receive(false, args),
    witnessReceive: args => receive(true, args),
    decodeRgbInvoice: request => run(async () => {
      if (typeof request !== 'string') fields(request, ['invoice']);
      const invoice = text(typeof request === 'string' ? request : request.invoice, 'invoice', 16384);
      const decoded = await account.inspectInvoice(invoice);
      rememberInvoice(decoded.recipientId, invoice);
      return {
        ...(decoded.assetId ? { assetId: decoded.assetId } : {}), amount: invoiceAmount(decoded), recipientId: decoded.recipientId,
        network: NETWORKS[decoded.network], transportEndpoints: decoded.transportEndpoints,
        ...(decoded.expirationTimestamp != null ? { expirationTimestamp: decoded.expirationTimestamp } : {}),
      };
    }),
    sendAsset: args => run(async () => {
      fields(args, ['invoice', 'assetId', 'amount', 'recipientId', 'feeRate', 'transportEndpoints']);
      const byInvoice = 'invoice' in args;
      if (byInvoice) fields(args, ['invoice', 'feeRate']);
      const recipient = text(byInvoice ? args.invoice : args.recipientId, 'RGB recipient', 16384);
      const invoice = !byInvoice && !recipient.includes('/') ? invoicesByRecipient.get(recipient) : recipient;
      if (!invoice || !invoice.startsWith('rgb:') || !invoice.includes('/')) {
        invalid('Decode the recipient’s full RGB invoice first so the wallet has its encrypted delivery details.');
      }
      const decoded = await account.inspectInvoice(invoice);
      if (NETWORKS[decoded.network] !== context.network) invalid('Wrong invoice network.');
      if (decoded.expirationTimestamp != null && decoded.expirationTimestamp <= Date.now() / 1000) invalid('The invoice has expired.');
      const requested = invoiceAmount(decoded);
      const assetId = byInvoice ? decoded.assetId : args.assetId;
      const amount = byInvoice ? requested : args.amount;
      if (!assetId || amount == null) invalid('An open invoice requires an explicit asset and amount.');
      integer(amount, 'amount', 1);
      if ((decoded.assetId && decoded.assetId !== assetId) || (requested !== null && requested !== amount)) invalid('The invoice and transfer terms differ.');
      if (!byInvoice && args.transportEndpoints !== undefined && JSON.stringify(args.transportEndpoints) !== JSON.stringify(decoded.transportEndpoints)) {
        invalid('The transport endpoints must match the invoice.');
      }
      const asset = await knownAsset(assetId);
      if ('token' in asset && amount !== 1) invalid('A collectible must transfer exactly one unit.');
      if (asset.balance.spendable < amount) invalid('Insufficient spendable asset balance.');
      const feeRate = fee(args.feeRate);
      await confirm([
        'Send ' + formatAssetAmount(amount, asset.precision) + ' ' + asset.ticker + ' (' + amount + ' base units)',
        'Asset: ' + assetId, 'Recipient: ' + decoded.recipientId,
        ...(/(^|:)wvout:/i.test(decoded.recipientId) ? ['Bitcoin sent to witness output: 1000 sats'] : []),
        'Mining fee rate: ' + feeRate + ' sat/vB', 'Confirmations: 3',
      ].join('\n'));
      const sent = await account.transfer({ token: assetId, recipient: invoice, amount, feeRate, minConfirmations: 3 }, guard);
      return { txid: sent.txid, transferId: sent.batchTransferIdx, assetId, amount, recipientId: decoded.recipientId };
    }),
    listTransfers: id => run(() => transfers(id)),
    getTransferStatus: (id, assetId) => run(async () => {
      if (typeof id === 'number') integer(id, 'transfer ID', 0);
      else text(id, 'transfer ID');
      const transfer = (await transfers(assetId)).find(t => String(t.transferId) === String(id) || t.txid === id || t.recipientId === id);
      return { found: !!transfer, status: transfer?.status ?? null, transfer: transfer ?? null };
    }),
    refresh: assetId => run(async () => {
      if (assetId !== undefined) await knownAsset(assetId);
      return { refreshed: await account.refreshForWebRgb(assetId, guard) };
    }),
    ...(account.signMessage ? {
      signMessage: (message: string) => run(async () => {
        validateSignMessage(message);
        await confirm('Sign this message with your wallet identity' + '\n\n' + message);
        guard();
        return { signature: account.signMessage!(message) };
      }),
    } : {}),
    ...(supportsReceivedMint(account) ? {
      getReceivedMint: (args: { invoice: string }) => run(async () => {
        fields(args, ['invoice']);
        const invoice = text(args.invoice, 'invoice', 16384);
        if (await AsyncStorage.getItem(ownedInvoiceKey(invoice)) !== '1') {
          throw failure('NOT_ENABLED', 'This origin is not authorized for this invoice.');
        }
        guard();
        return getReceivedMint(account, invoice, guard);
      }),
    } : {}),
  };
}
