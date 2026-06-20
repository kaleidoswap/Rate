/**
 * Apply Satoshi app-wide — the React Native equivalent of the extension's
 * global `html { font-family: 'Satoshi' }`.
 *
 * RN 0.81's `Text` / `TextInput` are plain function components (no patchable
 * `.render` static), and React 19 dropped `defaultProps` for function
 * components — so the classic "monkey-patch `Text.render`" trick is dead.
 *
 * Instead we wrap the two components and re-point the `react-native` module's
 * getters at the wrappers. Consumers compile `import { Text } from
 * 'react-native'` to a `_reactNative.Text` member-access at each use site, so
 * the wrapper is picked up everywhere without touching call sites. As a
 * belt-and-suspenders measure we also reassign the components' own module
 * default exports (the chokepoint the index getters read through), covering
 * any bundler interop that copies the index getter.
 *
 * Each wrapper PREPENDS the Satoshi face matching the element's resolved
 * `fontWeight`, so any explicit `style.fontFamily` a component sets (icon
 * fonts like Ionicons / MaterialCommunityIcons, etc.) still wins. The face is
 * chosen from the weight because RN won't synthesize weight from a single
 * custom family (notably on Android).
 *
 * Import once for its side effect, before the app renders:
 *   import './theme/satoshiText'
 *
 * Faces must be registered via `expo-font` (App.tsx `useFonts(kaleidoFonts)`)
 * before text paints; the app render is gated on that, so by first paint the
 * faces are loaded.
 */
import * as React from 'react';
import { StyleSheet, type TextStyle } from 'react-native';
import { satoshiFamilyForWeight, satoshiFontFamily } from '@kaleidorg/kaleido-ui/native/fonts';

type AnyComponent = React.ComponentType<{ style?: unknown }> & {
  __satoshiWrapped?: boolean;
};

type DefaultModule = { default?: AnyComponent };

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RN = require('react-native') as Record<string, AnyComponent>;

// The Satoshi faces we ship. A custom single-weight family on Android falls
// back to the system font if it's paired with a (non-normal) fontWeight — the
// weight has no matching variant — so once we pick a face we must neutralize
// fontWeight. Non-Satoshi families (icon fonts) are left completely alone.
const SATOSHI_FAMILIES = new Set<string>(Object.values(satoshiFontFamily));

function createFontWrapper(Original: AnyComponent, label: string): AnyComponent {
  // Plain function component: in React 19 `ref` arrives as a regular prop, so
  // spreading props forwards it to the underlying component untouched (keeps
  // TextInput.focus() and friends working).
  const Wrapped = ((props: { style?: unknown }) => {
    const flat = (StyleSheet.flatten(props.style as TextStyle) || {}) as TextStyle;
    const explicit = flat.fontFamily;

    // An explicit non-Satoshi family (Ionicons, MaterialCommunityIcons, …) —
    // leave it entirely untouched, including its fontWeight.
    if (explicit && !SATOSHI_FAMILIES.has(explicit)) {
      return React.createElement(Original, props);
    }

    // Pick the face: honour an already-Satoshi family, else map from weight.
    const family =
      explicit && SATOSHI_FAMILIES.has(explicit)
        ? explicit
        : satoshiFamilyForWeight(flat.fontWeight);

    // Override (append) so the face + neutral weight win over the incoming
    // style. fontWeight:'normal' is essential: the weight is baked into the
    // face name, and leaving a numeric/bold weight makes Android drop Satoshi.
    const override: TextStyle = { fontFamily: family, fontWeight: 'normal' };
    return React.createElement(Original, {
      ...props,
      style: [props.style, override],
    });
  }) as AnyComponent;

  // Carry over statics consumers rely on (e.g. TextInput.State) + displayName.
  Object.assign(Wrapped, Original);
  (Wrapped as { displayName?: string }).displayName = label;
  Wrapped.__satoshiWrapped = true;
  return Wrapped;
}

/**
 * Re-point `react-native`'s `Text` / `TextInput` at a font-injecting wrapper.
 * `mod` is the component's own module (default export read through by the index
 * getter) — reassigning it covers interop that copies the getter. It may be
 * null if the internal path can't be resolved; the index getter alone suffices.
 */
function applySatoshi(key: 'Text' | 'TextInput', mod: DefaultModule | null): void {
  const Original = RN[key];
  if (!Original || Original.__satoshiWrapped) return;

  const Wrapped = createFontWrapper(Original, key);

  // Primary: re-point the index getter (hits `import { X } from 'react-native'`).
  try {
    Object.defineProperty(RN, key, {
      configurable: true,
      enumerable: true,
      get: () => Wrapped,
    });
  } catch {
    // ignore — fall back to the module-default reassignment below
  }

  // Belt-and-suspenders: reassign the component's own module default export.
  try {
    if (mod && mod.default && !mod.default.__satoshiWrapped) {
      mod.default = Wrapped;
    }
  } catch {
    // default may be a read-only getter — the index getter above is enough
  }
}

// Metro requires static string literals for require(); resolve the internal
// modules defensively so a path change in a future RN version can't crash boot.
function safeRequire(loader: () => DefaultModule): DefaultModule | null {
  try {
    return loader();
  } catch {
    return null;
  }
}

applySatoshi(
  'Text',
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  safeRequire(() => require('react-native/Libraries/Text/Text')),
);
applySatoshi(
  'TextInput',
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  safeRequire(() => require('react-native/Libraries/Components/TextInput/TextInput')),
);
