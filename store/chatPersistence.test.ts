import { chatContentTransform } from './chatPersistence';

const chat = () => ({
  conversations: { abc: [{ id: '1', content: 'hello, decrypted' }] },
  loadingByPubkey: { abc: true },
  unreadByPubkey: { abc: 2 },
  paidInvoices: { lnbc1: true },
  activePubkey: null,
  sendScheme: 'nip17',
});

describe('chat persistence', () => {
  it('never writes decrypted messages to storage', () => {
    const written = chatContentTransform.in(chat() as any, 'chat', {} as any) as any;
    expect(written.conversations).toEqual({});
    expect(JSON.stringify(written)).not.toContain('decrypted');
  });

  it('keeps unread counts, paid markers and the send scheme', () => {
    const written = chatContentTransform.in(chat() as any, 'chat', {} as any) as any;
    expect(written.unreadByPubkey).toEqual({ abc: 2 });
    expect(written.paidInvoices).toEqual({ lnbc1: true });
    expect(written.sendScheme).toBe('nip17');
  });

  it('drops history saved by older builds on rehydrate', () => {
    const rehydrated = chatContentTransform.out(chat() as any, 'chat', {} as any) as any;
    expect(rehydrated.conversations).toEqual({});
  });

  it('does not mutate the live slice', () => {
    const live = chat();
    chatContentTransform.in(live as any, 'chat', {} as any);
    expect(live.conversations.abc).toHaveLength(1);
  });
});
