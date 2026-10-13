import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppTheme } from '../theme/ThemeProvider';
import { useAppDispatch } from '../store/hooks';
import { setLanguage } from '../store/slices/settingsSlice';
import MindSettingsScreen from './MindSettingsScreen';
import MessageBubble, { type ChatMessage } from '../components/chat/MessageBubble';
import { VoiceAgentOverlay } from '../components/voice-agent/VoiceAgentOverlay';
import { PrismoAnimatedCharacter } from '../components/mind/PrismoAnimatedCharacter';

/** Development-only native review. Uses production settings/messages/voice views, fictional conversation. */
export default function PrismoReviewScreen({ navigation, route }: any) {
  const theme = useAppTheme();
  const dispatch = useAppDispatch();
  const [page, setPage] = useState('chat');
  const [voice, setVoice] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'demo-1', isUser: true, text: 'Qual è il mio saldo?', timestamp: new Date() },
    { id: 'demo-2', isUser: false, text: 'Nella demo hai **120.000 sats** disponibili. Puoi continuare questa conversazione anche a voce.', timestamp: new Date() },
  ]);
  useEffect(() => { dispatch(setLanguage('it')); setPage(route?.params?.state === 'settings' ? 'settings' : 'chat'); setVoice(route?.params?.state === 'voice'); }, [route?.params?.state, dispatch]);
  if (!__DEV__) return null;
  return <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
    <View style={{ paddingTop: 60, paddingHorizontal: theme.spacing[4], gap: theme.spacing[2] }}>
      <Text style={{ color: theme.colors.text.secondary, textAlign: 'center' }}>ANTEPRIMA · DATI FITTIZI · NESSUN INVIO</Text>
      <View style={{ flexDirection: 'row', gap: theme.spacing[2] }}>{[['chat', 'Chat'], ['settings', 'Impostazioni'], ['voice', 'Talk']].map(([key, label]) => <Pressable key={key} accessibilityRole="button" onPress={() => key === 'voice' ? setVoice(true) : setPage(key)} style={{ flex: 1, alignItems: 'center', padding: theme.spacing[3], borderRadius: theme.borderRadius.md, backgroundColor: theme.colors.surface.primary }}><Text style={{ color: theme.colors.primary[500] }}>{label}</Text></Pressable>)}</View>
    </View>
    {page === 'settings' ? <MindSettingsScreen navigation={navigation} /> : <>
      <ScreenHeader title="Prismo" />
      <ScrollView contentContainerStyle={{ padding: theme.spacing[4] }}>
        <View style={{ alignItems: 'center' }}><PrismoAnimatedCharacter phase="idle" size={112} accessibilityLabel="Prismo ti saluta" /></View>
        {messages.map(message => <MessageBubble key={message.id} message={message} onCopy={() => {}} onLongPress={() => {}} onOpenLink={() => {}} />)}
        <Text style={{ color: theme.colors.text.secondary, textAlign: 'center' }}>Passa a Talk, tocca il microfono demo e torna qui: i messaggi restano.</Text>
      </ScrollView>
    </>}
    <VoiceAgentOverlay preview visible={voice} messages={messages} onMessagesChange={setMessages} onClose={() => setVoice(false)} />
  </View>;
}
