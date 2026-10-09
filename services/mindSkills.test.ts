// services/mindSkills.test.ts
//
// Skill ↔ tool CONNECTION tests. The agent scopes the model to a skill's
// declared tools (progressive disclosure); if a skill names a tool the mobile
// build doesn't actually mount, the model gets steered to a dead tool and the
// skill silently can't act. These tests assert, against the REAL tool sources
// the app assembles (buildMindToolSources), that:
//   1. every bundled skill's tools exist in the mounted registry, and
//   2. the keyword selector routes representative requests to the right skill.
//
// This is what would have caught `paid-data` pointing at `fetch_paid_resource`
// before the L402 source was wired.

import { ToolRegistry, SkillRegistry, skillsFromBundle, type SkillBundle } from '@kaleidorg/mind';
import { buildMindToolSources } from './mindAgent';
import skillBundle from '../skills.bundle.json';

// Native/host deps the tool sources import — stubbed; the tests only inspect
// tool *names* and skill selection, never execute a handler.
jest.mock('./protocols', () => ({
  protocolManager: { getAdapterIfAvailable: jest.fn(() => null) },
  kaleidoClientManager: { isInitialized: jest.fn(() => false), getClient: jest.fn() },
  flashnetClientManager: { isInitialized: jest.fn(() => false), getClient: jest.fn(), getPoolId: jest.fn() },
}));
jest.mock('../store/storeProvider', () => ({ getStore: jest.fn() }));
jest.mock('../store/slices/walletSlice', () => ({
  fetchBitcoinPrice: jest.fn(() => ({ type: 'wallet/fetchBitcoinPrice' })),
}));
jest.mock('./NostrService', () => ({ __esModule: true, default: { getInstance: jest.fn() } }));
jest.mock('../utils/lnurl', () => ({ resolveLightningAddressToInvoice: jest.fn() }));
jest.mock('./btcmapService', () => ({
  getUserLocation: jest.fn(),
  geocodeAddress: jest.fn(),
  findNearbyMerchants: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

const READ_REFERENCE_TOOL = 'read_skill_reference';

async function mountedToolNames(): Promise<Set<string>> {
  const registry = new ToolRegistry(buildMindToolSources({} as any));
  const tools = await registry.listTools();
  return new Set(tools.map((t) => t.name));
}

describe('skill bundle', () => {
  const skills = skillsFromBundle(skillBundle as SkillBundle);

  it('ships the expected skills, all with names and triggers', () => {
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual([
      'agent-wallet', 'bitrefill', 'kaleido-trading',
      'merchant-finder', 'paid-data', 'wallet-assistant',
    ]);
    for (const s of skills) {
      expect(s.name).toBeTruthy();
      expect((s.triggers ?? []).length).toBeGreaterThan(0);
    }
  });
});

describe('skill ↔ tool connection', () => {
  const skills = skillsFromBundle(skillBundle as SkillBundle);

  it('every skill can act with the tools the app mounts', async () => {
    const available = await mountedToolNames();
    available.add(READ_REFERENCE_TOOL);
    // Shared skills from @kaleidorg/mind also name tools other hosts provide
    // (e.g. kaleido-mcp); the engine hides the ones the app does not mount.
    // A skill must still have every `requires-tools` entry and at least one
    // of its tools mounted here.
    const unusable: Record<string, string[]> = {};
    for (const skill of skills) {
      const required = (skill.metadata?.['requires-tools'] ?? '').split(',').map((t) => t.trim()).filter(Boolean);
      const missingRequired = required.filter((t) => !available.has(t));
      const anyMounted = !skill.tools?.length || skill.tools.some((t) => available.has(t));
      if (missingRequired.length || !anyMounted) unusable[skill.name] = missingRequired.length ? missingRequired : skill.tools ?? [];
    }
    expect(unusable).toEqual({});
  });

  it('mounts the core wallet + paid-data + merchant tools', async () => {
    const available = await mountedToolNames();
    for (const t of [
      'get_balances', 'send_payment', 'rln_pay_invoice', 'create_invoice',
      'get_price', 'fiat_to_sats', 'resolve_contact',
      'find_merchant_locations', 'get_merchant_info',
      'kaleidoswap_get_pairs', 'kaleidoswap_get_quote', 'execute_swap',
      'kaleidoswap_atomic_status',
      'fetch_paid_resource', 'agent_budget_status', 'remember', 'recall', 'search_knowledge',
    ]) {
      expect(available.has(t)).toBe(true);
    }
  });
});

describe('skill selection (keyword router)', () => {
  const registry = new SkillRegistry(skillsFromBundle(skillBundle as SkillBundle));
  const cases: Array<[string, string]> = [
    ["what's my balance?", 'wallet-assistant'],
    ['pay bob 3 eur', 'wallet-assistant'],
    ['where can I spend bitcoin near me?', 'merchant-finder'],
    ['find a coffee shop that accepts bitcoin', 'merchant-finder'],
    ['unlock the premium data feed', 'paid-data'],
    ['buy a gift card with bitcoin', 'bitrefill'],
    ['how much can you spend today?', 'agent-wallet'],
    ["what's left of my agent wallet budget?", 'agent-wallet'],
    ['quote 100k sats to USDT', 'kaleido-trading'],
    ['swap btc for usdt', 'kaleido-trading'],
    ['swap btc for usdb on flashnet', 'kaleido-trading'],
  ];

  it.each(cases)('routes %p → %p', (query, expected) => {
    expect(registry.select(query)?.name).toBe(expected);
  });
});
