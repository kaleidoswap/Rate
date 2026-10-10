import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AppState, Image, Pressable } from 'react-native';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { WebView } from 'react-native-webview';
import { useReducedMotion } from 'react-native-reanimated';
import { prismoAnimationHtml } from './prismoAnimationHtml';

export interface PrismoAnimationRef { setLevel: (level: number) => void }
interface Props { phase: 'idle' | 'listening' | 'thinking' | 'speaking'; size?: number; onPress?: () => void; accessibilityLabel: string }
const original = require('../../assets/prismo/idle.png');
let imagesPromise: Promise<string[]> | undefined;
function loadImages() {
  return imagesPromise ??= Promise.all([original, require('../../assets/prismo/idle-blink.png')].map(async module => {
    const asset = await Asset.fromModule(module).downloadAsync();
    return `data:image/png;base64,${await new File(asset.localUri!).base64()}`;
  })).catch(error => { imagesPromise = undefined; throw error; });
}

/** Only phase and playback energy cross the bridge. Audio stays in the native TTS service. */
export const PrismoAnimatedCharacter = forwardRef<PrismoAnimationRef, Props>(function PrismoAnimatedCharacter(
  { phase, size = 200, onPress, accessibilityLabel }, ref,
) {
  const web = useRef<WebView>(null), ready = useRef(false);
  const [html, setHtml] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [rendered, setRendered] = useState(false);
  const reduced = useReducedMotion();
  const latest = useRef({ phase, reduced: !!reduced, paused: AppState.currentState !== 'active', level: 0 });
  const send = (state: object) => { if (ready.current) web.current?.injectJavaScript(`window.prismoUpdate?.(${JSON.stringify(state)});true;`); };
  useImperativeHandle(ref, () => ({ setLevel: level => {
    latest.current.level = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
    send({ level: latest.current.level });
  } }), []);
  useEffect(() => {
    let alive = true;
    loadImages().then(images => { if (alive) setHtml(prismoAnimationHtml(images)); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; ready.current = false; };
  }, []);
  useEffect(() => {
    latest.current.phase = phase; latest.current.reduced = !!reduced;
    if (phase !== 'speaking') latest.current.level = 0;
    send(latest.current);
  }, [phase, reduced]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      latest.current.paused = state !== 'active'; latest.current.level = 0; send(latest.current);
    });
    return () => sub.remove();
  }, []);
  const source = useMemo(() => ({ html: html ?? '' }), [html]);
  return <Pressable onPress={onPress} accessibilityRole={onPress ? 'button' : 'image'} accessibilityLabel={accessibilityLabel} style={{ width: size, height: size }}>
    {(!rendered || failed) && <Image source={original} style={{ width: size, height: size, position: 'absolute' }} resizeMode="contain" />}
    {!!html && !failed && <WebView ref={web} source={source} pointerEvents="none" scrollEnabled={false}
      style={{ width: size, height: size, backgroundColor: 'transparent' }}
      originWhitelist={['*']} onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
      onMessage={({ nativeEvent }) => {
        if (nativeEvent.data === 'ready') { ready.current = true; setRendered(true); send(latest.current); }
        else if (nativeEvent.data === 'failed') setFailed(true);
      }} onError={() => setFailed(true)} onContentProcessDidTerminate={() => setFailed(true)}
      accessible={false} />}
  </Pressable>;
});
