/**
 * NetworkIcon — renders protocol/network icons as PNG images.
 * Uses local PNG files from assets/icons/protocols/ (same icons as rate-extension).
 */
import React from 'react';
import { Image, ImageSourcePropType, View } from 'react-native';
import { theme } from '../theme';
import { LiquidIcon, OnchainIcon } from './ProtocolIcons';
import { chainIcon } from '../utils/orchestra-ui';

interface NetworkIconProps {
  network: string;
  size?: number;
  color?: string; // Ignored for PNGs but kept for API compat
}

const ICON_SOURCES: Record<string, ImageSourcePropType> = {
  spark: require('../assets/icons/protocols/spark.png'),
  SPARK: require('../assets/icons/protocols/spark.png'),
  arkade: require('../assets/icons/protocols/arkade.png'),
  ARKADE: require('../assets/icons/protocols/arkade.png'),
  rgb: require('../assets/icons/protocols/rgb.png'),
  RGB: require('../assets/icons/protocols/rgb.png'),
  rln: require('../assets/icons/protocols/rgb.png'),
  RLN: require('../assets/icons/protocols/rgb.png'),
  btc: require('../assets/icons/protocols/btc.png'),
  BTC: require('../assets/icons/protocols/btc.png'),
  bitcoin: require('../assets/icons/protocols/btc.png'),
  lightning: require('../assets/icons/protocols/lightning.png'),
  // Second's mark (second.tech/docs); Bark is Second's Ark wallet.
  bark: require('../assets/icons/protocols/bark.png'),
  BARK: require('../assets/icons/protocols/bark.png'),
  LN: require('../assets/icons/protocols/lightning.png'),
  ln: require('../assets/icons/protocols/lightning.png'),
};

/**
 * The icon key for a network's display name ("RGB Lightning" → rgb,
 * "On-chain" → onchain), or null when there's no icon for it.
 */
export function networkIconForLabel(label?: string | null): string | null {
  const l = String(label ?? '').toLowerCase();
  if (!l) return null;
  if (l.includes('rgb')) return 'rgb';
  if (l.includes('lightning') || l === 'ln') return 'lightning';
  if (l.includes('spark')) return 'spark';
  if (l.includes('arkade')) return 'arkade';
  if (l.includes('bark')) return 'bark';
  if (l.includes('liquid')) return 'liquid';
  if (l.includes('on-chain') || l.includes('onchain') || l === 'bitcoin') return 'onchain';
  return null;
}

export const NetworkIcon: React.FC<NetworkIconProps> = ({ network, size = 16 }) => {
  // On-chain is a way to pay, not the asset: the extension's chain-link glyph, not the BTC coin.
  if (network.toLowerCase() === 'onchain') return <OnchainIcon size={size} />;
  if (network.toLowerCase() === 'liquid') return <LiquidIcon size={size} />;
  // External chains (Ethereum, Tron, Solana…) use the bridge artwork.
  const source = ICON_SOURCES[network] || ICON_SOURCES[network.toLowerCase()] || chainIcon(network);

  if (!source) {
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors.gray[500] }} />;
  }

  return (
    <Image
      source={source}
      style={{ width: size, height: size, borderRadius: network.toLowerCase() === 'bark' ? size * 0.22 : size / 2 }}
      resizeMode="contain"
    />
  );
};

export default NetworkIcon;
