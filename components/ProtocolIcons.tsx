/**
 * Protocol SVG icons — exact SVGs from rate-extension.
 */
import React from 'react';
import { Image } from 'react-native';
import Svg, { G, Path, Rect, Polygon, Circle, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme';

const RGB_LOGO = require('../assets/icons/protocols/rgb.png');

interface IconProps {
  size?: number;
  color?: string;
}

/** Spark asterisk — exact path from extension */
export const SparkIcon: React.FC<IconProps> = ({ size = 24, color = '#60A5FA' }) => (
  <Svg width={size} height={size} viewBox="0 0 135 128" fill="none">
    <Path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z"
      fill={color}
    />
  </Svg>
);

/** Arkade grid shield — exact rects from extension */
export const ArkadeIcon: React.FC<IconProps> = ({ size = 24, color = '#A855F7' }) => (
  <Svg width={size} height={size} viewBox="0 0 1024 1024" fill="none">
    <Rect width="1024" height="1024" rx="200" fill={color} />
    <Rect x="512" y="256" width="128" height="128" fill="white" />
    <Rect x="384" y="256" width="128" height="128" fill="white" />
    <Rect x="640" y="384" width="128" height="128" fill="white" />
    <Rect x="256" y="384" width="128" height="128" fill="white" />
    <Rect x="384" y="512" width="128" height="128" fill="white" />
    <Rect x="512" y="512" width="128" height="128" fill="white" />
    <Rect x="640" y="640" width="128" height="128" fill="white" />
    <Rect x="256" y="640" width="128" height="128" fill="white" />
    <Path d="M640 256L768 384H640V256Z" fill="white" />
    <Path d="M384 256L256 384H384V256Z" fill="white" />
  </Svg>
);

/** Lightning bolt */
export const LightningIcon: React.FC<IconProps> = ({ size = 24, color = '#FACC15' }) => (
  <Svg width={size} height={size} viewBox="0 0 512 512" fill="none">
    <Polygon
      points="357.016,284.718 127.381,512 218.95,282.398 97.907,212.514 202.824,33.17 327.203,104.979 246.056,220.655"
      fill={color}
    />
  </Svg>
);

/** Bitcoin circle with B */
export const BitcoinIcon: React.FC<IconProps> = ({ size = 24, color = '#F7931A' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="11" fill={color} />
    <Path d="M14.5 10C14.5 8.9 13.6 8 12.5 8H10V12H12.5C13.6 12 14.5 11.1 14.5 10Z" fill="white" />
    <Path d="M12.5 12H10V16H12.5C13.6 16 14.5 15.1 14.5 14C14.5 12.9 13.6 12 12.5 12Z" fill="white" />
    <Path d="M11 6V8M13 6V8M11 16V18M13 16V18" stroke="white" strokeWidth="1.5" />
  </Svg>
);

/** RGB — the logo the extension uses (kaleido-ui protocolIcons). It's full colour, so `color` is ignored. */
export const RgbIcon: React.FC<IconProps> = ({ size = 24 }) => (
  <Image source={RGB_LOGO} style={{ width: size, height: size }} resizeMode="contain" />
);

/** On-chain (L1) — the chain-link glyph the Rate extension uses for on-chain. */
export const OnchainIcon: React.FC<IconProps> = ({ size = 24, color = theme.colors.networks.bitcoin }) => (
  <Svg width={size} height={size} viewBox="0 0 47.5 47.5" fill={color}>
    <G transform="matrix(1.25 0 0 -1.25 0 47.5)">
      <Path d="m16 28 6 6s6 6 12 0 0-12 0-12l-8-8s-6-6-12 0c-1.125 1.125-1.822 2.62-1.822 2.62l3.353 3.348S15.396 18.604 17 17c0 0 3-3 6 0l8 8s3 3 0 6-6 0-6 0l-3.729-3.729s-1.854 1.521-5.646.354L16 28Z" />
      <Path d="m21.845 10-6-6s-6-6-12 0 0 12 0 12l8 8s6 6 12 0c1.125-1.125 1.822-2.62 1.822-2.62l-3.353-3.349s.135 1.365-1.469 2.969c0 0-3 3-6 0l-8-8s-3-3 0-6 6 0 6 0l3.729 3.729s1.854-1.52 5.646-.354L21.845 10Z" />
    </G>
  </Svg>
);

/** USD — green coin with a white dollar sign (matches the brand USDt mark) */
export const UsdCoinIcon: React.FC<IconProps> = ({ size = 24, color = '#16A974' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* darker rim for a subtle coin depth */}
    <Circle cx="12" cy="12" r="11" fill={color} opacity={0.85} />
    <Circle cx="12" cy="11.4" r="9.6" fill={color} />
    <SvgText
      x="12"
      y="16.6"
      fill="#FFFFFF"
      fontSize="15"
      fontWeight="900"
      textAnchor="middle"
    >
      $
    </SvgText>
  </Svg>
);

/** Liquid Network mark (the official logo the extension ships). Full colour, so `color` is ignored. */
export const LiquidIcon: React.FC<IconProps> = ({ size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 2000 2000" fill="none">
    <Circle cx="1000" cy="1000" r="1000" fill="#0D1437" />
    <Path d="M930.3,828.5c47.5-284.6,351.6-246.9,387.8-241.3,37.7,11.4,74.5-26,53.2-62.1-83.8-143.2-250.7-236.6-377.5-243.2,31.5-24.9,137.2-38.6,249.3-34,39.5,1.4,56.1-50.5,22.6-71.7-2.8-1.8-5.7-3.8-9.8-5.2-153.2-47.1-317.6-51.4-474.1-10.3-116,30.1-228.1,84.8-327.5,165.4-41.5,34-79.7,70.8-113.1,109.8-249.3,289.8-280,715.9-67.4,1039.5,4.3,6.6,8.5,12.8,12.8,19.4,3.8,4.8,5.2,7.1,6.6,8.9,9.8,14.6,20.8,28.8,32,42.9,12.3,15.1,25.4,29.7,38.6,43.8,3.2,3.8,6.6,7.1,10.3,10.8,12.3,12.8,24.9,25.4,38.1,37.2.9.9,2.3,1.8,3.2,3.2,14.2,12.8,28.8,24.9,43.4,36.8,3.2,2.8,7.1,5.7,10.8,8.5,13.7,10.3,27.4,20.3,41.1,30.1,1.8.9,3.2,2.3,5.2,3.8,15.5,10.3,31.5,20.8,48,30.1,3.2,1.8,6.6,3.8,9.4,5.7,15.1,8.5,30.1,16.5,45.2,24,1.8.9,3.2,1.8,5.2,2.3,17.4,8.5,34.9,16,52.8,23.1,2.3.9,4.8,1.8,7.1,2.8,16.9,6.6,34,12.8,50.9,17.8,1.4,0,2.8.9,3.8,1.4,18.9,6.2,37.7,11.4,57.1,16,.9,0,1.8,0,2.3.5,18.9,4.8,37.7,8.5,57.1,11.8h2.3c40,6.6,80.1,10.3,120.6,11.8h.9c199.4,5.2,401-57.5,568.4-192.7,102.3-82.9,180.9-183.8,234.7-295,2.8-6.2,6.2-12.8,8.9-18.9,15.5-34.5,29.2-70.1,40-106-523.2,197-959.5-71.2-900.2-426.5l-.5-.9.2.5Z" fill="#14909C" />
    <Path d="M623.9,915.7c101.8-137.2,148.9-113.1,158.7-155.5,13.2-58-198.4-108.4-363.3,18.3,229-286.6,585.8-352.6,889.7-195,40.5,21.2,85.8-19.4,62.6-58.5-83.8-143.2-250.7-236.6-377.5-243.2,31.5-24.9,137.2-38.6,249.3-34,39.5,1.4,56.1-50.5,22.6-71.7-2.8-1.8-5.7-3.8-9.8-5.2-153.2-47.1-317.6-51.4-474.1-10.3-116,30.1-228.1,84.8-327.5,165.4-41.5,34-79.7,70.8-113.1,109.8-249.3,289.8-280,715.9-67.4,1039.5,4.3,6.6,8.5,12.8,12.8,19.4,3.8,4.8,5.2,7.1,6.6,8.9,9.8,14.6,20.8,28.8,32,42.9,222,274.3,576.4,377.5,896.3,293.2-818.2-121.1-693.3-795.6-598.1-923.7v-.5.2Z" fill="#22E1C9" />
  </Svg>
);

export function getProtocolIcon(protocol: string): React.FC<IconProps> {
  switch (protocol.toUpperCase()) {
    case 'SPARK': return SparkIcon;
    case 'ARKADE': return ArkadeIcon;
    case 'RGB':
    case 'RLN': return RgbIcon;
    case 'BTC':
    case 'BITCOIN': return BitcoinIcon;
    case 'LIGHTNING':
    case 'LN': return LightningIcon;
    case 'ONCHAIN': return OnchainIcon;
    case 'LIQUID': return LiquidIcon;
    default: return RgbIcon;
  }
}
