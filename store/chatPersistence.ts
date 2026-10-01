// store/chatPersistence.ts
//
// Keeps decrypted direct messages out of redux-persist. AsyncStorage is a
// plaintext file, so persisting `conversations` left every DM readable at
// rest. Messages are re-fetched (and re-decrypted) from the relays when a
// conversation is opened (ChatScreen → loadConversation), so only small,
// non-content state is kept: unread counts, paid-invoice markers and the
// send scheme.
import { createTransform } from 'redux-persist';

const stripChatContent = (chat: any) => {
  if (!chat || typeof chat !== 'object') return chat;
  return { ...chat, conversations: {}, loadingByPubkey: {} };
};

// Applied both ways: on write so new history never reaches disk, and on
// rehydrate so history saved by older builds is dropped from memory and
// overwritten on the next save.
export const chatContentTransform = createTransform(
  stripChatContent,
  stripChatContent,
  { whitelist: ['chat'] },
);

export { stripChatContent };
