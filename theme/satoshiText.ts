/**
 * Apply Satoshi app-wide — the React Native equivalent of the extension's
 * global `html { font-family: 'Satoshi' }`.
 *
 * RN has no global font hook, so we patch the base `Text` / `TextInput`
 * render to PREPEND the matching Satoshi face. Prepending (not appending)
 * means any explicit `style.fontFamily` a component sets still wins — so icon
 * fonts (Ionicons, MaterialCommunityIcons) and other deliberate families are
 * untouched. The face is chosen from the resolved `fontWeight` because RN
 * won't synthesize weight from a single custom family (notably on Android).
 *
 * Import once for its side effect, before the app renders:
 *   import './theme/satoshiText'
 *
 * The family names must be registered via `expo-font` (see App.tsx
 * `useFonts(kaleidoFonts)`) before text paints; we gate the app render on
 * that, so by first paint the faces are loaded.
 */
import { cloneElement, isValidElement } from 'react';
import { Text, TextInput, StyleSheet, type TextStyle } from 'react-native';
import { satoshiFamilyForWeight } from '@kaleidorg/kaleido-ui/native/fonts';

type Patchable = {
  render?: (...args: unknown[]) => unknown;
  __satoshiPatched?: boolean;
};

function patchComponent(Component: Patchable): void {
  if (!Component?.render || Component.__satoshiPatched) return;
  const original = Component.render;
  Component.render = function patchedRender(...args: unknown[]) {
    const element = original.apply(this, args);
    if (!isValidElement(element)) return element;
    const incoming = (element.props as { style?: unknown }).style;
    const flat = (StyleSheet.flatten(incoming as TextStyle) || {}) as TextStyle;
    const base: TextStyle = { fontFamily: satoshiFamilyForWeight(flat.fontWeight) };
    return cloneElement(element as React.ReactElement<{ style?: unknown }>, {
      style: [base, incoming],
    });
  };
  Component.__satoshiPatched = true;
}

patchComponent(Text as unknown as Patchable);
patchComponent(TextInput as unknown as Patchable);
