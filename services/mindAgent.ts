// KaleidoMind agent — rate's host binding over the shared core Funnel.
//
// The tier routing (T0 fast-path → T2 recipe → T1 skill-scoped agentic), the
// confirm gate, history trimming, persona/ambient-tool settings — all live in
// @kaleidorg/mind's Funnel, shared with desktop. This file only supplies what
// is mobile-specific:
//   - the QVAC LLM provider (with per-turn temperature/maxTokens + thinking)
//   - the tool sources (wallet/WDK, merchant, memory, RAG, skill references)
//   - AsyncStorage persistence for memory
//
// ONE agent used by BOTH the chat screen and the voice overlay, so they
// behave identically. Settings are read per turn via `getSettings`, so
// changing them never rebuilds the engine or drops the RAG index.

import {
  Funnel,
  ToolRegistry,
  SkillRegistry,
  InMemoryMemoryStore,
  createMemoryToolSource,
  createSkillReferenceToolSource,
  skillsFromBundle,
  type FunnelResult,
  type FunnelSettings,
  type LLMProvider,
  type Message,
  type Skill,
  type SkillBundle,
  type ToolSource,
} from '@kaleidorg/mind';
import type { QvacTurnStats } from '@kaleidorg/mind/qvac';
import skillBundle from '../skills.bundle.json';
import { buildWalletToolSource } from './walletTools';
import { buildMerchantToolSource } from './merchantTools';
import { buildSwapToolSource } from './swapTools';
import { buildPaidDataToolSource } from './aiPaidData';
import { buildKnowledgeToolSource } from './aiKnowledge';
import { asyncStorageMemoryIO } from './aiMemory';
import type QVACService from './QVACService';

/** Skills shipped with the app, rehydrated from the build-time bundle. */
const SKILLS: Skill[] = skillsFromBundle(skillBundle as SkillBundle);

const SOUL =
  'You are KaleidoSwap, a concise, privacy-first assistant running fully ' +
  'on-device inside a non-custodial Bitcoin, Lightning and RGB wallet. Use the ' +
  'provided tools to take actions: pay invoices and contacts, create invoices, ' +
  'check balances, find Bitcoin-accepting merchants nearby. Never invent a ' +
  'balance, address, amount or result — always call the relevant tool and ' +
  'report what it returns. All BTC amounts are in satoshis. Keep replies ' +
  'short and friendly.';

/** Per-user agent settings (the persisted MindConfig satisfies this shape). */
export interface MindAgentSettings {
  /** Extra instructions appended to the system prompt. */
  persona?: string;
  /** Sampling temperature, applied per turn in the provider closure. */
  temperature?: number;
  /** Max tokens per reply, applied per turn in the provider closure. */
  maxTokens?: number;
  /** History messages to keep in the prompt (small models overflow fast). */
  historyLength?: number;
  /** Expose the search_knowledge (RAG) tool. */
  ragEnabled?: boolean;
  /** Expose the remember/recall (memory) tools. */
  memoryEnabled?: boolean;
  /** Skill names the user turned off. */
  disabledSkills?: string[];
  /** Max reasoning↔tool rounds in the agentic tier. */
  maxTurns?: number;
}

/** Callbacks the host wires to the chat/voice UI. The Funnel owns all of these
 *  except `onThinking`, which the provider streams via the closure below. */
export interface RunTurnCallbacks {
  history?: Message[];
  onStart?: (requestId: string) => void;
  onToken?: (token: string, turn: number) => void;
  onToolCall?: (
    call: { name: string; arguments: Record<string, unknown> },
    info: { requiresConfirmation: boolean }
  ) => void;
  onConfirm?: (call: {
    name: string;
    arguments: Record<string, unknown>;
  }) => Promise<{ approved: boolean; reason?: string }>;
  /** A recipe step is executing (deterministic tier). */
  onStep?: (name: string) => void;
  /** The model's chain-of-thought, streamed as it reasons (shown on demand). */
  onThinking?: (token: string) => void;
  /** Real per-turn inference stats (tok/s, tokens, backend device) for the UI. */
  onStats?: (stats: QvacTurnStats) => void;
}

export type MindTurnResult = FunnelResult;

export interface MindAgent {
  runTurn(text: string, cbs?: RunTurnCallbacks): Promise<MindTurnResult>;
  /** Skills currently enabled (for the skills sheet). */
  listSkills(): Skill[];
}

// Memory has no per-agent deps, so a single store is shared across chat + voice
// → both see the same recall within a session (and persist to one AsyncStorage
// key). The RAG source is memoized too so its on-device index is built once.
let sharedMemory: ToolSource | null = null;
let sharedMemoryStore: InMemoryMemoryStore | null = null;
let sharedKnowledge: ToolSource | null = null;
function memorySource(): ToolSource {
  if (!sharedMemory) {
    sharedMemoryStore = new InMemoryMemoryStore({ io: asyncStorageMemoryIO() });
    sharedMemory = createMemoryToolSource(sharedMemoryStore);
  }
  return sharedMemory;
}
function knowledgeSource(qvac: QVACService): ToolSource {
  if (!sharedKnowledge) sharedKnowledge = buildKnowledgeToolSource(qvac);
  return sharedKnowledge;
}

/** Wipe long-term memory — the live in-RAM store AND the persisted copy, so the
 *  "Clear memory" action takes effect immediately (not just after a restart). */
export async function clearMindMemory(): Promise<void> {
  if (sharedMemoryStore) await sharedMemoryStore.clear();
  else await asyncStorageMemoryIO().save([]);
}

/**
 * The exact tool sources the mobile agent mounts — wallet/WDK, merchants,
 * swaps (KaleidoSwap maker + Flashnet, venue-aware), paid data (L402), memory,
 * RAG, and the skill-reference reader. All execute ON-DEVICE (no P2P
 * delegation). Exported so the skill-connection test asserts every bundled
 * skill scopes to tools that actually exist here (no skill can point at a
 * missing tool).
 *
 * LSPS1 channel orders (lsp_*) are intentionally NOT mounted yet — deferred to
 * a later pass; the core 0.3.0 lsps1 contract is ready to bind when we add it.
 */
export function buildMindToolSources(qvac: QVACService): ToolSource[] {
  return [
    buildWalletToolSource(),
    buildMerchantToolSource(),
    buildSwapToolSource(),
    buildPaidDataToolSource(),
    memorySource(),
    knowledgeSource(qvac),
    createSkillReferenceToolSource(new SkillRegistry(SKILLS)),
  ];
}

/**
 * Build the shared agent. Drives @kaleidorg/mind's Funnel so mobile runs the
 * SAME tiered routing as desktop: deterministic fast-path and recipes first
 * (reliable on a 0.6B), skill-scoped agentic loop for the rest, with the
 * spend-confirmation gate enforced by the contract.
 */
export function createMindAgent(
  qvac: QVACService,
  getSettings: () => MindAgentSettings = () => ({}),
): MindAgent {
  // The Funnel builds each TurnInput internally, so we inject the per-turn
  // thinking + stats sinks + sampling settings here via closures read at call time.
  let thinkingSink: ((token: string) => void) | undefined;
  let statsSink: ((stats: QvacTurnStats) => void) | undefined;
  const provider: LLMProvider = {
    name: 'qvac',
    runTurn: (i) => {
      const s = getSettings();
      return qvac.runProviderTurn({
        ...i,
        ...(s.temperature != null ? { temperature: s.temperature } : {}),
        ...(s.maxTokens != null ? { maxTokens: s.maxTokens } : {}),
        onThinking: (t) => thinkingSink?.(t),
        onStats: (st) => statsSink?.(st),
      });
    },
    cancel: (id) => qvac.cancelRequest(id),
  };

  const tools = new ToolRegistry(buildMindToolSources(qvac));

  const funnel = new Funnel({
    provider,
    tools,
    skills: SKILLS,
    system: SOUL,
    maxTurns: getSettings().maxTurns ?? 5,
    // Read fresh each turn — persona/history/memory/RAG/disabled-skill toggles
    // take effect immediately without rebuilding the funnel or the RAG index.
    getSettings: (): FunnelSettings => {
      const s = getSettings();
      return {
        persona: s.persona || undefined,
        historyLength: s.historyLength,
        memoryEnabled: s.memoryEnabled,
        ragEnabled: s.ragEnabled,
        disabledSkills: s.disabledSkills,
      };
    },
  });

  return {
    async runTurn(text, cbs: RunTurnCallbacks = {}) {
      // Make this turn's reasoning + stats available to the provider closure.
      thinkingSink = cbs.onThinking;
      statsSink = cbs.onStats;
      try {
        return await funnel.runTurn(text, {
          history: cbs.history,
          onStart: cbs.onStart,
          onToken: cbs.onToken,
          onStep: cbs.onStep,
          onToolCall: cbs.onToolCall,
          onConfirm: cbs.onConfirm,
        });
      } finally {
        thinkingSink = undefined;
        statsSink = undefined;
      }
    },
    listSkills: () => funnel.listSkills(),
  };
}
