import { AGENT_ACTIVITY_KIND, agentActivityItems, agentEntryTitle } from './activity';
import { matchesActivityFilter } from '../../utils/activity-layers';
import type { AgentLedgerEntry } from './store';

const e = (patch: Partial<AgentLedgerEntry>): AgentLedgerEntry => ({
  id: 'x', kind: 'spend', at: 1000, amountSats: 21, feeSats: 1, status: 'paid', service: 'api.example.com', ...patch,
});

describe('agent wallet activity', () => {
  it('turns the log into Activity rows, leaving refused and declined attempts out', () => {
    const items = agentActivityItems([
      e({ id: 'a' }),
      e({ id: 'b', kind: 'topup', amountSats: 5000, feeSats: 0, service: undefined }),
      e({ id: 'c', kind: 'withdraw', amountSats: 1000, feeSats: 0, status: 'pending', service: undefined }),
      e({ id: 'd', status: 'refused' }),
      e({ id: 'f', status: 'cancelled' }),
      e({ id: 'g', status: 'failed' }),
    ]);
    expect(items.map((i) => [i.id, i.type, i.status, i.assetName])).toEqual([
      ['agent-a', 'send', 'confirmed', 'Agent paid api.example.com'],
      ['agent-b', 'send', 'confirmed', 'Agent wallet top-up'],
      ['agent-c', 'receive', 'pending', 'Agent wallet withdrawal'],
      ['agent-g', 'send', 'failed', 'Agent paid api.example.com'],
    ]);
    expect(items[0]).toMatchObject({ kind: AGENT_ACTIVITY_KIND, amount: '21', rawSats: 21, fee: 1, layer: 'Spark', account: 'Agent wallet' });
  });

  it('can list only payments, for the main feed', () => {
    const items = agentActivityItems([e({ id: 'a' }), e({ id: 'b', kind: 'topup' })], { spendsOnly: true });
    expect(items.map((i) => i.id)).toEqual(['agent-a']);
  });

  it('has its own Activity filter', () => {
    const [agent] = agentActivityItems([e({})]);
    expect(matchesActivityFilter(agent, 'agent')).toBe(true);
    expect(matchesActivityFilter({ type: 'send', status: 'confirmed', layer: 'Spark' }, 'agent')).toBe(false);
    expect(matchesActivityFilter(agent, 'send')).toBe(true);
  });

  it('names entries plainly', () => {
    expect(agentEntryTitle({ kind: 'spend' })).toBe('Agent payment');
  });
});
