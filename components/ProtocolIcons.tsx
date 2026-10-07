/**
 * Protocol SVG icons — exact SVGs from rate-extension.
 */
import React from 'react';
import { Image, View } from 'react-native';
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

/**
 * The RGB Lightning Node: the RGB logo with a small Lightning badge in the
 * corner, so the node reads apart from RGB assets and plain Lightning.
 */
export const RgbNodeIcon: React.FC<IconProps & { badgeBackground?: string }> = ({
  size = 24,
  badgeBackground = theme.colors.surface.secondary,
}) => {
  const badge = Math.max(10, Math.round(size * 0.5));
  return (
    <View style={{ width: size, height: size }}>
      <RgbIcon size={size} />
      <View
        style={{
          position: 'absolute',
          right: -badge * 0.2,
          bottom: -badge * 0.2,
          width: badge,
          height: badge,
          borderRadius: badge / 2,
          backgroundColor: badgeBackground,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <LightningIcon size={badge * 0.72} color={theme.colors.networks.lightning} />
      </View>
    </View>
  );
};

/** Nostr — the ostrich mark the extension ships (public/icons/nostr-icon.svg). */
export const NostrIcon: React.FC<IconProps> = ({ size = 24, color = '#8D45DD' }) => (
  <Svg width={size} height={size} viewBox="49 12 2000 2000" fill="none">
    <Path
      d="M1049 12C496.755 12 49 459.755 49 1012C49 1564.24 496.755 2012 1049 2012C1601.24 2012 2049 1564.24 2049 1012C2049 459.755 1601.24 12 1049 12ZM1623.29 782.408C1581.04 852.612 1494.92 900.367 1486.96 904.449C1470.84 913.02 1464.92 925.469 1465.94 944.041C1466.96 962.612 1462.47 1054.65 1406.35 1095.27C1377.57 1116.08 1261.45 1143.02 1208.18 1152C1180.84 1156.69 1174.51 1165.06 1159.41 1174.04C1139 1186.69 1066.55 1287.1 1054.31 1309.35C1055.94 1309.14 1282.67 1238.73 1292.88 1237.1C1319.82 1233.02 1340.22 1240.78 1353.49 1260.37C1366.14 1279.14 1378.59 1298.12 1391.04 1317.1C1395.53 1323.84 1399.82 1330.78 1404.1 1337.71L1408.59 1344.86C1410.22 1347.51 1412.47 1350.57 1413.49 1354.65C1414.31 1357.51 1416.14 1367.1 1410.63 1372.82C1405.53 1378.12 1396.76 1378.12 1392.06 1376.9C1387.57 1375.67 1380.84 1373.02 1375.33 1368.53L1367.78 1362.2C1361.86 1357.1 1350.63 1354.65 1341.86 1355.06C1331.65 1355.47 1318.18 1352.2 1311.65 1348.12C1299 1339.96 1295.73 1319.55 1295.73 1319.35C1294.1 1312.61 1289.2 1310.78 1284.71 1310.78C1276.55 1310.57 1270.22 1313.02 1263.69 1314.86C1233.9 1323.84 1204.31 1333.02 1174.51 1342.41L1131.86 1355.67C1110.84 1362.2 1089.82 1368.73 1069 1375.67C1063.29 1377.51 1057.78 1380.37 1051.86 1383.43C1049.41 1384.65 1046.96 1385.88 1044.51 1387.1C1042.06 1388.33 1039.41 1389.76 1036.96 1391.18C1031.45 1394.24 1025.53 1397.51 1019 1399.35C997.776 1405.67 979.204 1396.49 970.429 1375.27C964.714 1361.59 969.816 1334.45 972.878 1326.49C992.061 1276.69 1054.51 1182.82 1054.51 1182.2C1053.49 1181.8 985.327 1209.14 974.102 1217.71C943.286 1241.18 871.041 1296.69 870.02 1302C865.327 1326.69 850.02 1345.27 826.551 1354.45C809.612 1360.98 799.408 1374.45 789.408 1387.51C789.408 1387.51 608.388 1636.9 596.143 1650.37C592.469 1654.45 558.592 1689.96 549.612 1706.49C547.571 1710.57 539.816 1726.9 537.776 1730.98C536.143 1734.24 532.469 1743.02 518.592 1742.41C504.714 1741.8 504.306 1722.41 503.694 1714.04C502.265 1693.43 506.755 1673.22 517.571 1652C518.592 1649.96 530.837 1631.39 526.347 1616.49C522.265 1603.43 518.388 1583.22 524.51 1573.02C534.102 1556.9 551.041 1556.29 573.694 1552.61C589.408 1549.96 600.837 1542.2 611.857 1526.08C635.122 1492.2 722.674 1367.92 742.469 1339.14C747.776 1331.59 751.857 1321.8 753.694 1312.2C759.408 1283.22 776.959 1263.02 807.571 1250.57C814.102 1247.92 935.939 1146.08 935.939 1133.02C935.939 1123.63 922.674 1118.53 912.469 1115.67C911.041 1115.27 834.51 1095.47 799.612 1079.55C780.633 1070.98 766.347 1063.43 749.408 1051.18C726.347 1034.24 680.225 1042.41 673.49 1043.43C640.837 1048.12 616.551 1062.82 589 1081.39C584.102 1084.86 559 1093.84 546.347 1086.69C521.653 1072.61 467.367 1047.31 447.367 1016.9C438.184 1002.82 439.408 979.959 445.939 954.653C466.959 895.878 497.98 869.551 555.327 853.633C596.143 839.551 678.388 836.49 717.98 833.429C720.633 832.612 808.388 830.571 870.02 798.939C911.041 777.918 1032.88 696.898 1208.18 702.408C1279 704.653 1412.88 773.837 1464.51 775.878C1517.16 778.122 1543.49 772.204 1573.9 740.776C1582.47 731.796 1619 653.02 1584.51 609.959C1571.65 594.041 1558.39 579.755 1543.08 566.694C1522.47 549.143 1501.04 532.408 1482.47 512.612C1441.45 469.143 1428.8 409.755 1448.18 363.429C1460.63 330.98 1486.76 316.898 1524.51 324.245C1551.04 329.347 1570.43 353.225 1589.41 365.878C1600.02 373.02 1617.78 377.102 1629.41 379.959C1644.1 383.429 1655.12 394.653 1654.51 402.204C1653.9 409.755 1634.51 416.286 1615.94 414.857C1593.9 413.429 1556.14 413.225 1533.49 420.776C1518.39 426.286 1511.65 443.02 1516.14 459.551C1519.82 473.02 1548.59 497.102 1559.41 506.082C1581.04 523.837 1604.1 539.959 1622.06 562.204C1642.27 587.51 1652.88 616.286 1656.14 648.122C1661.04 696.898 1648.18 740.776 1623.29 782.408Z"
      fill={color}
    />
  </Svg>
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
    case 'RGB': return RgbIcon;
    case 'RLN': return RgbNodeIcon;
    case 'BTC':
    case 'BITCOIN': return BitcoinIcon;
    case 'LIGHTNING':
    case 'LN': return LightningIcon;
    case 'ONCHAIN': return OnchainIcon;
    case 'LIQUID': return LiquidIcon;
    case 'NOSTR': return NostrIcon;
    default: return RgbIcon;
  }
}
