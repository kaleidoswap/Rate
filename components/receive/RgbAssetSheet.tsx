import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { Sheet } from '../Sheet';
import { AssetIcon } from '../AssetIcon';
import { RgbIcon } from '../ProtocolIcons';
import { feedback } from '../../utils/feedback';
import { ANY_RGB_ASSET_ID, shortContractId } from '../../utils/rgb-receive';

export interface RgbAssetChoice {
  asset_id: string;
  ticker: string;
  name: string;
  icon?: string;
}

export function RgbAssetSheet({ visible, onClose, accountLabel, held, selectedAssetId, onPickAny, onPickAsset }: {
  visible: boolean;
  onClose: () => void;
  /** Where it lands: RGB on this phone or the RGB Lightning node. */
  accountLabel: string;
  held: RgbAssetChoice[];
  selectedAssetId?: string;
  onPickAny: () => void;
  onPickAsset: (asset: RgbAssetChoice) => void;
}) {
  const t = useAppTheme();

  const row = (key: string, icon: React.ReactNode, title: string, detail: string, onPress: () => void) => {
    const checked = selectedAssetId === key;
    return (
      <TouchableOpacity key={key} accessible accessibilityRole="radio" accessibilityState={{ checked }} accessibilityLabel={`${title}. ${detail}`} activeOpacity={0.7}
        onPress={() => { feedback.select(); onPress(); onClose(); }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], padding: t.spacing[3], borderRadius: t.borderRadius.lg,
          borderWidth: 1, borderColor: checked ? t.colors.primary[500] : t.colors.border.light, backgroundColor: t.colors.surface.primary }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.colors.surface.secondary, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: t.colors.text.primary, fontWeight: '600' }}>{title}</Text>
          <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>{detail}</Text>
        </View>
        <Ionicons name={checked ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={checked ? t.colors.primary[500] : t.colors.text.tertiary} />
      </TouchableOpacity>
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Receive an RGB asset" subtitle={`Received on-chain into ${accountLabel}`}>
      <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: t.spacing[2], paddingBottom: t.spacing[2] }}>
        {row(ANY_RGB_ASSET_ID, <RgbIcon size={22} />, 'Any RGB asset', 'The sender chooses, including assets you don’t hold yet.', onPickAny)}
        {held.length > 0 && <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: t.spacing[2] }}>
          Assets you hold
        </Text>}
        {held.map(asset => {
          const label = asset.ticker || asset.name;
          const sameLabel = held.some(other => other.asset_id !== asset.asset_id && (other.ticker || other.name) === label);
          const name = asset.name === label ? '' : asset.name;
          const detail = [name, (sameLabel || !name) && shortContractId(asset.asset_id)].filter(Boolean).join(' · ');
          return row(asset.asset_id, <AssetIcon ticker={asset.ticker} logoUri={asset.icon} protocol="RGB" size={22} showBadge={false} />,
            label, detail, () => onPickAsset(asset));
        })}
      </ScrollView>
    </Sheet>
  );
}
