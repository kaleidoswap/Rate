/**
 * NetworkIcon — renders protocol/network icons as PNG images.
 * Uses local PNG files from assets/icons/protocols/ (same icons as rate-extension).
 */
import React from 'react';
import { Image, ImageSourcePropType, View } from 'react-native';

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
  onchain: require('../assets/icons/protocols/btc.png'),
  lightning: require('../assets/icons/protocols/lightning.png'),
  LN: require('../assets/icons/protocols/lightning.png'),
  ln: require('../assets/icons/protocols/lightning.png'),
};

export const NetworkIcon: React.FC<NetworkIconProps> = ({ network, size = 16 }) => {
  const source = ICON_SOURCES[network] || ICON_SOURCES[network.toLowerCase()];

  if (!source) {
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#64748B' }} />;
  }

  return (
    <Image
      source={source}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      resizeMode="contain"
    />
  );
};

export default NetworkIcon;
