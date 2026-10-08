import { stepForTool, turnProgressLabel } from './turnProgress';

describe('turn progress', () => {
  it('names the step and the elapsed time', () => {
    expect(turnProgressLabel('Thinking', 12_400)).toBe('Thinking… 12 s');
  });
  it('adds an estimate once the device speed is known', () => {
    expect(turnProgressLabel('Thinking', 3_000, { tokensPerSecond: 8.4, maxTokens: 512 }))
      .toBe('Thinking… 3 s · a step can take up to ~61 s at 8 tok/s');
    expect(turnProgressLabel('Thinking', 3_000, { tokensPerSecond: 0, maxTokens: 512 })).toBe('Thinking… 3 s');
  });
  it('labels tools plainly and approvals as waiting on the user', () => {
    expect(stepForTool('kaleidoswap_get_quote')).toBe('Getting a quote');
    expect(stepForTool('rln_list_assets')).toBe('Running rln list assets');
    expect(stepForTool('send_payment', true)).toBe('Waiting for your approval');
  });
});
