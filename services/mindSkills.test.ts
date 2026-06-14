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
    expect(names).toEqual(['bitrefill', 'merchant-finder', 'paid-data', 'wallet-assistant']);
    for (const s of skills) {
      expect(s.name).toBeTruthy();
      expect((s.triggers ?? []).length).toBeGreaterThan(0);
    }
  });
});

describe('skill ↔ tool connection', () => {
  const skills = skillsFromBundle(skillBundle as SkillBundle);

  it('every skill scopes only to tools the app actually mounts', async () => {
    const available = await mountedToolNames();
    // The reference reader is added to a skill's scope by the registry, not the
    // frontmatter, so it must resolve too.
    available.add(READ_REFERENCE_TOOL);

    const missing: Record<string, string[]> = {};
    for (const skill of skills) {
      for (const tool of skill.tools ?? []) {
        if (!available.has(tool)) (missing[skill.name] ??= []).push(tool);
      }
    }
    expect(missing).toEqual({});
  });

  it('mounts the core wallet + paid-data + merchant tools', async () => {
    const available = await mountedToolNames();
    for (const t of [
      'get_balances', 'send_payment', 'rln_pay_invoice', 'create_invoice',
      'get_price', 'fiat_to_sats', 'resolve_contact',
      'find_merchant_locations', 'get_merchant_info',
      'fetch_paid_resource', 'remember', 'recall', 'search_knowledge',
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
  ];

  it.each(cases)('routes %p → %p', (query, expected) => {
    expect(registry.select(query)?.name).toBe(expected);
  });
});
