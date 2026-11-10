// Concept passages for Prismo's knowledge base, next to the shared Bitcoin-copilot
// corpus (which covers liquidity, channels, swaps and the app's layers). These
// answer the general "what is / how does" questions: Bitcoin itself, how Lightning
// moves a payment, and what RGB is and how it validates assets.
//
// Short and plain on purpose: a passage is pasted into a small on-device model's
// prompt, so it must be correct on its own and quick to read.

import type { RagDocument } from '@kaleidorg/mind';

export const CONCEPT_DOCS: RagDocument[] = [
  {
    id: 'bitcoin-what',
    text:
      'Bitcoin is a digital money that no company or government runs. Thousands of ' +
      'computers (nodes) keep the same public ledger, the blockchain, and check every ' +
      'transaction against the same rules. There will only ever be 21 million bitcoin. ' +
      'Whoever holds the keys to some bitcoin can spend it, so a non-custodial wallet ' +
      'like this one keeps your keys on your phone.',
    metadata: { topic: 'bitcoin' },
  },
  {
    id: 'bitcoin-sats',
    text:
      'A satoshi (sat) is the smallest unit of bitcoin: 1 bitcoin = 100,000,000 sats. ' +
      'Wallets often show amounts in sats because everyday payments are a small ' +
      'fraction of one bitcoin.',
    metadata: { topic: 'bitcoin' },
  },
  {
    id: 'bitcoin-blocks',
    text:
      'Miners group transactions into a block about every 10 minutes and add it to the ' +
      'blockchain. A transaction waiting for a block sits in the mempool and is ' +
      'unconfirmed; once it is in a block it has 1 confirmation, and each later block ' +
      'adds one. More confirmations make it practically impossible to reverse.',
    metadata: { topic: 'bitcoin' },
  },
  {
    id: 'bitcoin-fees',
    text:
      'On-chain fees are paid to miners and depend on the transaction size in virtual ' +
      'bytes (vB) times the fee rate in sat/vB, not on the amount sent. When many ' +
      'people transact, higher fee rates confirm sooner. A stuck transaction can be ' +
      'sped up by replacing it with a higher fee (RBF) or by spending its output with ' +
      'a high-fee child transaction (CPFP).',
    metadata: { topic: 'bitcoin' },
  },
  {
    id: 'bitcoin-utxo',
    text:
      'Bitcoin balances are made of UTXOs: unspent outputs of earlier transactions, ' +
      'like coins and notes in a purse. Spending uses whole UTXOs as inputs and sends ' +
      'any remainder back to you as change.',
    metadata: { topic: 'bitcoin' },
  },
  {
    id: 'seed-phrase',
    text:
      'The seed phrase (recovery phrase, 12 or 24 words) is the master backup of a ' +
      'wallet: anyone with it can take the funds, and without it a lost phone means ' +
      'lost funds. Write it on paper, keep it offline, never type it into a website or ' +
      'share it, not even with support.',
    metadata: { topic: 'bitcoin' },
  },
  {
    id: 'lightning-what',
    text:
      'Lightning is a network of payment channels built on top of Bitcoin. Payments ' +
      'settle in seconds for tiny fees because they update balances inside channels ' +
      'instead of waiting for a block. Only opening and closing a channel touches the ' +
      'blockchain. It suits everyday and small payments; on-chain suits large or ' +
      'long-term savings.',
    metadata: { topic: 'lightning' },
  },
  {
    id: 'lightning-routing',
    text:
      'A Lightning payment can cross several channels. The receiver makes an invoice ' +
      'with a payment hash; the sender locks the payment along a route with HTLCs ' +
      '(hash time-locked contracts). The receiver reveals the secret (preimage) to ' +
      'collect it, and that preimage unlocks every hop back to the sender, so either ' +
      'the whole payment completes or nothing moves. The preimage is the proof of payment.',
    metadata: { topic: 'lightning' },
  },
  {
    id: 'lightning-invoice',
    text:
      'A Lightning invoice (BOLT11, starting with lnbc on mainnet) says how much to pay, ' +
      'to whom and for what, and it expires, usually after an hour. Pay each invoice ' +
      'once. Lightning addresses (name@domain) and BOLT12 offers (lno…) are reusable and ' +
      'produce a fresh invoice each time.',
    metadata: { topic: 'lightning' },
  },
  {
    id: 'rgb-what',
    text:
      'RGB is a protocol for issuing and moving assets, like USDT or gold tokens (XAUT), ' +
      'on Bitcoin and Lightning. The asset data is not stored on the blockchain: it is ' +
      'kept by the owners and checked by the receiver (client-side validation). Bitcoin ' +
      'only anchors each transfer with a commitment in a normal transaction, so RGB ' +
      'transfers look like ordinary Bitcoin transactions and stay private.',
    metadata: { topic: 'rgb' },
  },
  {
    id: 'rgb-seals',
    text:
      'RGB assigns assets to Bitcoin UTXOs as single-use seals: spending the UTXO closes ' +
      'the seal, so the asset cannot be spent twice. To send, the sender builds a ' +
      'consignment with the asset history the receiver needs, delivers it (through an ' +
      'RGB proxy), and the receiver validates it before accepting. The transfer settles ' +
      'once the anchoring Bitcoin transaction confirms.',
    metadata: { topic: 'rgb' },
  },
  {
    id: 'rgb-receive-steps',
    text:
      'Receiving an RGB asset: you share an RGB invoice, the sender sends the consignment ' +
      '(waiting for the other side), you validate it, then it waits for the bitcoin ' +
      'confirmations and becomes settled and spendable. Receiving on-chain needs a little ' +
      'bitcoin in the wallet for the UTXOs that hold assets.',
    metadata: { topic: 'rgb' },
  },
  {
    id: 'rgb-schemas',
    text:
      'RGB asset types (schemas): NIA for simple fungible tokens like stablecoins, IFA ' +
      'for fungible tokens that can be inflated later, CFA for collectible fungible ' +
      'assets, and UDA for unique items (NFT-like collectibles). Each asset has an asset ' +
      'id starting with rgb:.',
    metadata: { topic: 'rgb' },
  },
  {
    id: 'rgb-lightning',
    text:
      'RGB assets can also move over Lightning in channels that carry an asset next to ' +
      'bitcoin (colored channels), run by an RGB Lightning Node (RLN). That gives instant ' +
      'asset payments and atomic swaps between bitcoin and assets like USDT.',
    metadata: { topic: 'rgb' },
  },
  {
    id: 'layers-spark-ark',
    text:
      'Spark and Ark (Arkade) are other Bitcoin layers this wallet supports. Spark moves ' +
      'bitcoin and tokens like USDB off-chain with an operator group that cannot take ' +
      'your funds. Ark batches many users into shared on-chain outputs (VTXOs) that you ' +
      'can always exit to Bitcoin on your own.',
    metadata: { topic: 'layers' },
  },
];
