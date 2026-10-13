import { toVoiceMessage, toChatMessage } from './prismoConversation';
it('preserves message identity, timestamps and wallet cards across chat and Talk', () => {
  const original = { id: 'one', text: 'Saldo', isUser: false, timestamp: new Date(), card: { type: 'balance' as const, data: { total: 100 } }, functionCalled: 'balance', functionResult: { sats: 100 } };
  const voice = toVoiceMessage(original);
  expect(voice.role).toBe('assistant');
  expect(toChatMessage(voice)).toEqual({ ...original, streaming: false });
});
