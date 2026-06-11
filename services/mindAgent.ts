// KaleidoMind agent — rate's host binding over the shared core Funnel.
//
// The tier routing (T0 fast-path → T2 recipe → T1 skill-scoped agentic), the
// confirm gate, history trimming, persona/ambient-tool settings — all live in
// @kaleidorg/mind's Funnel now, shared with desktop. This file only supplies
// what is mobile-specific:
//   - the QVAC LLM provider (with per-turn temperature/maxTokens + thinking)
//   - the tool sources (wallet/WDK, merchant, memory, RAG, L402)
//   - AsyncStorage persistence for memory
//
// ONE agent used by BOTH the chat screen and the voice overlay, so they
// behave identically. Settings are read per turn via `getSettings`, so
// changing them never rebuilds the engine or drops the RAG index.

import {
  Funnel,
  ToolRegistry,
  InMemoryMemoryStore,
  createMemoryToolSource,
  createL402ToolSource,
  skillsFromBundle,
  type FunnelCallbacks,
  type FunnelResult,
  type FunnelSettings,
  type LLMProvider,
  type Skill,
  type SkillBundle,
} from '@kaleidorg/mind';
import skillBundle from '../skills.bundle.json';
import { buildWalletToolSource } from './walletTools';
import { buildMerchantToolSource } from './merchantTools';
import { buildKnowledgeToolSource } from './aiKnowledge';
import { asyncStorageMemoryIO } from './aiMemory';
import { protocolManager } from './protocols';
import type QVACService from './QVACService';

const SOUL =
  'You are KaleidoSwap, a concise, privacy-first assistant running fully ' +
  'on-device inside a non-custodial Bitcoin, Lightning and RGB wallet. Use the ' +
  'provided tools to take actions: pay invoices and contacts, create invoices, ' +
  'check balances, find Bitcoin-accepting merchants nearby. Never invent a ' +
  'balance, address, amount or result — always call the relevant tool and ' +
  'report what it returns. All BTC amounts are in satoshis. Keep replies ' +
  'short and friendly.';

/** Per-user agent settings (FunnelSettings + mobile sampling knobs). */
export interface MindAgentSettings extends FunnelSettings {
  temperature?: number;
  maxTokens?: number;
}

export interface RunTurnCallbacks extends FunnelCallbacks {
  /** The model's chain-of-thought, streamed as it reasons (shown on demand). */
  onThinking?: (token: string) => void;
}

export type MindTurnResult = FunnelResult;

export interface MindAgent {
  runTurn(text: string, cbs?: RunTurnCallbacks): Promise<MindTurnResult>;
  /** Skills currently enabled (for the skills sheet). */
  listSkills(): Skill[];
}

/** Pay a BOLT11 with the on-device Lightning wallet (Spark preferred, RLN
 *  fallback) — the shared spend path for L402 (and future paid sources). */
async function payInvoiceOnDevice(invoice: string): Promise<{ preimage: string }> {
  const spark = protocolManager.getAdapterIfAvailable('SPARK');
  const rln = protocolManager.getAdapterIfAvailable('RGB');
  const adapter: any = spark?.isConnected() ? spark : rln?.isConnected() ? rln : null;
  if (!adapter) throw new Error('No Lightning wallet connected to pay the invoice');
  const r: any = await adapter.sendPayment({ invoice });
  return { preimage: r?.preimage ?? r?.paymentPreimage ?? r?.payment_preimage ?? '' };
}

/**
 * Build the shared agent. Stable for the lifetime of a QVACService instance —
 * tool sources, the Funnel and the RAG retriever are built once; user settings
 * flow in per turn through `getSettings`.
 */
export function createMindAgent(
  qvac: QVACService,
  getSettings: () => MindAgentSettings = () => ({}),
): MindAgent {
  // The Funnel builds each TurnInput internally, so we inject the per-turn
  // thinking sink + sampling settings here via closures read at call time.
  let thinkingSink: ((token: string) => void) | undefined;
  const provider: LLMProvider = {
    name: 'qvac',
    runTurn: (i) => {
      const s = getSettings();
      return qvac.runProviderTurn({
        ...i,
        ...(s.temperature != null ? { temperature: s.temperature } : {}),
        ...(s.maxTokens != null ? { maxTokens: s.maxTokens } : {}),
        onThinking: (t) => thinkingSink?.(t),
      });
    },
    cancel: (id) => qvac.cancelRequest(id),
  };

  const memoryStore = new InMemoryMemoryStore({ io: asyncStorageMemoryIO() });
  const funnel = new Funnel({
    provider,
    tools: new ToolRegistry([
      buildWalletToolSource(),
      buildMerchantToolSource(),
      createMemoryToolSource(memoryStore),
      buildKnowledgeToolSource(qvac),
      createL402ToolSource({
        payInvoice: payInvoiceOnDevice,
        maxAutoPaySats: 1000,
        requiresConfirmation: false,
        log: (m: string) => console.log('[L402]', m),
      }),
    ]),
    skills: skillsFromBundle(skillBundle as SkillBundle),
    system: SOUL,
    getSettings,
    log: (m) => console.log('[AI]', m),
  });

  return {
    async runTurn(text, cbs: RunTurnCallbacks = {}) {
      // Make this turn's reasoning available to the provider closure.
      thinkingSink = cbs.onThinking;
      try {
        return await funnel.runTurn(text, cbs);
      } finally {
        thinkingSink = undefined;
      }
    },
    listSkills: () => funnel.listSkills(),
  };
}
