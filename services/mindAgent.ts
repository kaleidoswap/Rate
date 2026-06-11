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
  Engine,
  ToolRegistry,
  SkillRegistry,
  createSkillReferenceToolSource,
  skillsFromBundle,
  type AgenticResult,
  type LLMProvider,
  type Message,
  type Skill,
  type SkillBundle,
  type ToolResult,
} from '@kaleidorg/mind';
import skillBundle from '../skills.bundle.json';
import { buildWalletToolSource } from './walletTools';
import { buildMerchantToolSource } from './merchantTools';
import type QVACService from './QVACService';

const SOUL =
  'You are KaleidoSwap, a concise, privacy-first assistant running fully ' +
  'on-device inside a non-custodial Bitcoin, Lightning and RGB wallet. Use the ' +
  'provided tools to take actions: pay invoices and contacts, create invoices, ' +
  'check balances, find Bitcoin-accepting merchants nearby. Never invent a ' +
  'balance, address, amount or result — always call the relevant tool and ' +
  'report what it returns. All BTC amounts are in satoshis. Keep replies ' +
  'short and friendly.';

/** Per-user agent settings. Newer settings are kept optional for compatibility. */
export interface MindAgentSettings {
  temperature?: number;
  maxTokens?: number;
  disabledSkills?: string[];
  enabledSkills?: string[];
  maxTurns?: number;
}

export interface RunTurnCallbacks {
  history?: { role: 'user' | 'assistant' | 'system' | 'tool'; content: string }[];
  onStart?: (requestId: string, turn?: number) => void;
  onToken?: (token: string, turn: number) => void;
  onToolCall?: (
    call: { name: string; arguments: Record<string, unknown> },
    info: { requiresConfirmation?: boolean; turn: number }
  ) => void;
  onConfirm?: (call: {
    name: string;
    arguments: Record<string, unknown>;
  }) => Promise<{ approved: boolean; reason?: string }>;
  onStep?: (name: string) => void;
  /** The model's chain-of-thought, streamed as it reasons (shown on demand). */
  onThinking?: (token: string) => void;
}

export type MindTurnResult =
  | (AgenticResult & { tier: 'agentic'; toolCalls: ToolResult[] })
  | { tier: 'fast'; text: string; intent?: string; data?: unknown; toolCalls?: ToolResult[] }
  | { tier: 'recipe'; text: string; toolCalls?: ToolResult[] };

export interface MindAgent {
  runTurn(text: string, cbs?: RunTurnCallbacks): Promise<MindTurnResult>;
  /** Skills currently enabled (for the skills sheet). */
  listSkills(): Skill[];
}

/**
 * Build the shared agent. This branch consumes the published @kaleidorg/mind
 * 0.1 engine surface; newer Funnel/RAG/memory helpers are not in that package
 * yet, so keep this wrapper on Engine until the dependency is bumped.
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

  const skills = skillsFromBundle(skillBundle as SkillBundle);
  const skillRegistry = new SkillRegistry(skills);
  const tools = new ToolRegistry([
    buildWalletToolSource(),
    buildMerchantToolSource(),
    createSkillReferenceToolSource(skillRegistry),
  ]);
  const engine = new Engine({
    provider,
    tools,
    defaultSystem: SOUL,
    defaultMaxTurns: 5,
  } as any);

  return {
    async runTurn(text, cbs: RunTurnCallbacks = {}) {
      // Make this turn's reasoning available to the provider closure.
      thinkingSink = cbs.onThinking;
      try {
        cbs.onStep?.('thinking');
        const settings = getSettings();
        const activeSkill = selectSkill(text, skillRegistry, settings);
        const composed = skillRegistry.compose(SOUL, activeSkill);
        const messages: Message[] = [
          { role: 'system', content: composed.system },
          ...(cbs.history ?? []),
          { role: 'user' as const, content: text },
        ];
        const result = await engine.runAgentic(messages, {
          maxTurns: settings.maxTurns ?? 5,
          allowedTools: composed.allowedTools,
          onStart: cbs.onStart,
          onToken: cbs.onToken,
          onConfirm: cbs.onConfirm,
          onToolCall: async (
            call: { name: string; arguments: Record<string, unknown> },
            turn: number
          ) => {
            const def = await tools.getDef(call.name);
            cbs.onToolCall?.(call, { requiresConfirmation: def?.requiresConfirmation, turn });
          },
        } as any);
        return { ...result, tier: 'agentic' as const, toolCalls: result.toolCalls ?? [] };
      } finally {
        thinkingSink = undefined;
      }
    },
    listSkills: () => skillRegistry.list(),
  };
}

function selectSkill(
  query: string,
  registry: SkillRegistry,
  settings: MindAgentSettings
): Skill | null {
  const disabled = new Set(settings.disabledSkills ?? []);
  const enabled = settings.enabledSkills ? new Set(settings.enabledSkills) : null;
  const selected = registry.select(query);
  if (!selected) return null;
  if (disabled.has(selected.name)) return null;
  if (enabled && !enabled.has(selected.name)) return null;
  return selected;
}
