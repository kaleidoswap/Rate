// Shared KaleidoMind agent — the mobile funnel (Tier-0 fast-path → Tier-2 recipe
// → agentic loop) over the contract wallet tools + memory + on-device RAG.
//
// One runner used by BOTH chat and voice so they behave identically. The caller
// supplies UI callbacks (token streaming, step progress, spend confirmation) and
// the conversation history; everything else — tools, skills, recipes, the
// confirm gate — lives here, in @kaleidorg/mind.

import {
  Engine,
  ToolRegistry,
  FastPath,
  WALLET_FAST_INTENTS,
  RecipeRegistry,
  paymentsRecipe,
  receiveRecipe,
  assetSendRecipe,
  runRecipe,
  InMemoryMemoryStore,
  createMemoryToolSource,
  SkillRegistry,
  skillsFromBundle,
  type LLMProvider,
  type ConfirmDecision,
  type Message as MindMessage,
  type SkillBundle,
} from '@kaleidorg/mind';
import skillBundle from '../skills.bundle.json';
import { buildWalletToolSource } from './walletTools';
import { buildKnowledgeToolSource } from './aiKnowledge';
import { asyncStorageMemoryIO } from './aiMemory';
import type QVACService from './QVACService';

const SOUL =
  'You are KaleidoSwap, a concise, privacy-first assistant running fully ' +
  'on-device inside a non-custodial Bitcoin, Lightning and RGB wallet. Use the ' +
  'provided tools to take actions — never invent a balance, address, amount or ' +
  'result. All BTC amounts are in satoshis. Keep replies short and friendly.';

const AMBIENT = ['remember', 'recall', 'search_knowledge'];

export interface RunTurnCallbacks {
  history?: MindMessage[];
  onToken?: (token: string, turn: number) => void;
  /** The model's chain-of-thought, streamed as it reasons (shown on demand). */
  onThinking?: (token: string) => void;
  onStep?: (name: string) => void;
  onConfirm?: (call: { name: string; arguments: Record<string, unknown> }) => Promise<ConfirmDecision>;
}

export interface MindAgent {
  runTurn(text: string, cbs?: RunTurnCallbacks): Promise<{ text: string }>;
}

function renderFast(intent: string, r: any): string {
  if (intent === 'balance') {
    const sats = Number(r?.total_sats ?? 0);
    const n = r?.layers?.length ?? 0;
    return `You have ${sats.toLocaleString()} sats${n > 1 ? ` across ${n} layers` : ''}.`;
  }
  if (intent === 'address') return r?.address ? `Here's your receive address:\n\n\`${r.address}\`` : 'No address available right now.';
  return `Bitcoin is $${Number(r?.price_usd ?? 0).toLocaleString()}.`;
}

/** Build the shared agent. Stable for the lifetime of a QVACService instance. */
export function createMindAgent(qvac: QVACService): MindAgent {
  // The engine builds each TurnInput internally, so we inject the per-turn
  // thinking sink here via a mutable holder set at the start of runTurn().
  let thinkingSink: ((token: string) => void) | undefined;
  const provider: LLMProvider = {
    name: 'qvac',
    runTurn: (i) => qvac.runProviderTurn({ ...i, onThinking: (t) => thinkingSink?.(t) }),
  };
  const walletRegistry = new ToolRegistry([buildWalletToolSource()]);
  const memoryStore = new InMemoryMemoryStore({ io: asyncStorageMemoryIO() });
  const engine = new Engine({
    provider,
    tools: new ToolRegistry([buildWalletToolSource(), createMemoryToolSource(memoryStore), buildKnowledgeToolSource(qvac)]),
    defaultMaxTurns: 5,
  });
  const fastPath = new FastPath(WALLET_FAST_INTENTS);
  const recipes = new RecipeRegistry([assetSendRecipe, paymentsRecipe, receiveRecipe]);
  const skills = new SkillRegistry(skillsFromBundle(skillBundle as SkillBundle));

  async function runTurn(text: string, cbs: RunTurnCallbacks = {}): Promise<{ text: string }> {
    // Make this turn's reasoning available to the provider closure (cleared after).
    thinkingSink = cbs.onThinking;
    // Tier-0: deterministic fast-path (no LLM).
    const fast = fastPath.select(text);
    if (fast) {
      const r = await walletRegistry.execute(fast.tool, fast.args);
      return { text: renderFast(fast.intent.name, r) };
    }

    // Tier-2: recipe multi-step — fire only when the recipe is confident given
    // its extracted slots (payments need a recipient; receive always fires).
    const recipe = recipes.select(text);
    const slots = recipe?.extract?.(text) ?? null;
    const fires = !!recipe && !!slots && (recipe.confident ? recipe.confident(slots) : Object.keys(slots).length > 0);
    if (recipe && fires) {
      const res = await runRecipe(recipe, text, {
        provider,
        tools: walletRegistry,
        onConfirm: cbs.onConfirm,
        onStep: cbs.onStep ? (name) => cbs.onStep!(name) : undefined,
      });
      return { text: res.text };
    }

    // Tier-1: skill-scoped agentic loop (memory tools stay ambient).
    const skill = skills.select(text);
    const { system, allowedTools } = skills.compose(SOUL, skill);
    const scoped = allowedTools ? [...new Set([...allowedTools, ...AMBIENT])] : undefined;
    const messages: MindMessage[] = [
      { role: 'system', content: system },
      ...(cbs.history ?? []),
      { role: 'user', content: text },
    ];
    const res = await engine.runAgentic(messages, {
      allowedTools: scoped,
      onToken: cbs.onToken,
      onConfirm: cbs.onConfirm,
    });
    return { text: res.text ?? '' };
  }

  return { runTurn };
}
