import React, { useEffect, useRef, useState } from 'react';
import { AppState, View, Text, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { prismoTalkPreviewHtml } from './prismoTalkPreviewHtml';

/** Offline visual integration for simulator review; never starts microphone or wallet tools. */
export default function PrismoTalkPreview({ onClose }: { onClose: () => void }) {
  const theme = useAppTheme();
  const web = useRef<WebView>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') web.current?.injectJavaScript("document.querySelector('#voice')?.pause(); document.dispatchEvent(new Event('visibilitychange')); true;");
    });
    return () => sub.remove();
  }, []);
  return <View style={{ flex: 1, backgroundColor: '#10111b' }}>
    <View style={{ paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 21, color: theme.colors.text.primary }}>Prismo · Talk</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to preview chat" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="close" size={22} color={theme.colors.text.primary} /></TouchableOpacity>
    </View>
    {failed ? <Text style={{ padding: 24, color: theme.colors.text.primary }}>Anteprima non disponibile. Chiudi e riapri la demo.</Text> : <WebView ref={web}
      source={{ html: prismoTalkPreviewHtml }} style={{ flex: 1, backgroundColor: '#10111b' }}
      originWhitelist={['*']} onShouldStartLoadWithRequest={request => !/^https?:/i.test(request.url)}
      javaScriptEnabled allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false}
      onError={() => setFailed(true)} onContentProcessDidTerminate={() => setFailed(true)}
      accessibilityLabel="Prismo Talk animated demo" />}
  </View>;
}
