import type { ChatMessage } from '../components/chat/MessageBubble';
export type VoiceMessage = ChatMessage & { role: 'user' | 'assistant' };
export const toVoiceMessage = (message: ChatMessage): VoiceMessage => ({ ...message, role: message.isUser ? 'user' : 'assistant' });
export const toChatMessage = ({ role, ...message }: VoiceMessage): ChatMessage => ({ ...message, isUser: role === 'user', streaming: false });
