import { localizePrismoReply } from './prismoReplies';
jest.mock('../localization/language', () => ({ ...jest.requireActual('../localization/language'), getAppLanguage: () => 'it' }));
it('localizes deterministic balance and preserves amount and network count', () => {
  expect(localizePrismoReply({ tier: 'fast', text: 'You have 120,000 sats across 3 layers.' } as any).text).toBe('Hai 120,000 sats su 3 reti.');
});
it('keeps an invoice unchanged while localizing its introduction', () => {
  const invoice = 'lnbc1test123';
  expect(localizePrismoReply({ tier: 'recipe', text: `Here's your BTC invoice for 500 sats:\n\n${invoice}` } as any).text).toBe(`Ecco la richiesta di pagamento BTC per 500 sats:\n\n${invoice}`);
});
it('never rewrites model answers', () => {
  const reply: any = { tier: 'agentic', text: 'Sent 3 sats to Alice.' };
  expect(localizePrismoReply(reply)).toBe(reply);
});
