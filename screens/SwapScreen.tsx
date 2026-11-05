import React, { useState } from 'react';
import MakerRoutesScreen from './MakerRoutesScreen';
import AssetSwapScreen from './AssetSwapScreen';

/** One Swap entry point. Existing token executors retain their reviewed flows. */
export default function SwapScreen({ navigation, route }: { navigation: any; route?: any }) {
  const [otherAssets, setOtherAssets] = useState(!!route?.params?.toAsset);
  if (otherAssets) return <AssetSwapScreen navigation={{ ...navigation, goBack: () => setOtherAssets(false) }} route={route} />;
  return <MakerRoutesScreen navigation={navigation} unified onOtherAssets={() => setOtherAssets(true)} />;
}
