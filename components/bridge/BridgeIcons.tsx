// components/bridge/BridgeIcons.tsx
//
// Chain and asset artwork for the cross-chain flows, with an initial on the
// chain's brand colour when we ship no artwork for it.
import React from 'react';
import { Image, Text, View, type ImageSourcePropType } from 'react-native';
import { useAppTheme } from '../../theme/ThemeProvider';
import { assetIcon, chainColor, chainIcon } from '../../utils/orchestra-ui';

function Round({ source, label, tint, size }: { source?: ImageSourcePropType; label: string; tint?: string; size: number }) {
  const t = useAppTheme();
  if (source) {
    return <Image source={source} style={{ width: size, height: size, borderRadius: size / 2 }} resizeMode="contain" />;
  }
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
      backgroundColor: tint ?? t.colors.surface.tertiary,
    }}>
      <Text style={{ color: t.colors.text.primary, fontSize: Math.max(8, size * 0.45), fontWeight: '700' }}>
        {label.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

export function ChainIcon({ chain, size = 20 }: { chain: string; size?: number }) {
  return <Round source={chainIcon(chain)} label={chain} tint={chainColor(chain)} size={size} />;
}

/** Asset artwork, with the chain as a small badge in the corner when given. */
export function BridgeAssetIcon({ ticker, chain, size = 24 }: { ticker: string; chain?: string; size?: number }) {
  const t = useAppTheme();
  const badge = Math.round(size * 0.5);
  return (
    <View style={{ width: size, height: size }}>
      <Round source={assetIcon(ticker)} label={ticker} size={size} />
      {!!chain && (
        <View style={{
          position: 'absolute', right: -badge / 4, bottom: -badge / 4, borderRadius: badge,
          borderWidth: 1.5, borderColor: t.colors.surface.primary,
        }}>
          <ChainIcon chain={chain} size={badge} />
        </View>
      )}
    </View>
  );
}

/** A few chain logos overlapping, e.g. on the "Deposit from another chain" entry. */
export function ChainStack({ chains, size = 22 }: { chains: string[]; size?: number }) {
  const t = useAppTheme();
  return (
    <View style={{ flexDirection: 'row' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {chains.map((chain, i) => (
        <View key={chain} style={{
          marginLeft: i === 0 ? 0 : -size * 0.35, borderRadius: size, borderWidth: 2,
          borderColor: t.colors.surface.primary, zIndex: chains.length - i,
        }}>
          <ChainIcon chain={chain} size={size} />
        </View>
      ))}
    </View>
  );
}
