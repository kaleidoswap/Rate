import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { Sheet } from '../Sheet';
import { Input } from '../Input';
import { Button } from '../Button';
import { AssetIcon } from '../AssetIcon';
import { RgbIcon } from '../ProtocolIcons';
import { feedback } from '../../utils/feedback';
import { parseRgbContractId, shortContractId } from '../../utils/rgb-receive';

export interface RgbAssetChoice {
  asset_id: string;
  ticker: string;
  name: string;
}

/**
 * "Receive an RGB asset": any asset (the sender chooses), one the wallet holds, or a
 * specific one by its contract id.
 */
export function RgbAssetSheet({ visible, onClose, accountLabel, held, onPickAny, onPickAsset }: {
  visible: boolean;
  onClose: () => void;
  /** Where it lands: RGB on this phone or the RGB Lightning node. */
  accountLabel: string;
  held: RgbAssetChoice[];
  onPickAny: () => void;
  onPickAsset: (asset: RgbAssetChoice) => void;
}) {
  const t = useAppTheme();
  const [contractId, setContractId] = useState('');
  const [byId, setById] = useState(false);
  useEffect(() => { if (!visible) { setContractId(''); setById(false); } }, [visible]);
  const parsed = parseRgbContractId(contractId);

  const row = (key: string, icon: React.ReactNode, title: string, detail: string, onPress: () => void, chevron = 'chevron-forward') => (
    <TouchableOpacity key={key} accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`} activeOpacity={0.7}
      onPress={() => { feedback.select(); onPress(); }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], padding: t.spacing[3], borderRadius: t.borderRadius.lg,
        borderWidth: 1, borderColor: t.colors.border.light, backgroundColor: t.colors.surface.primary }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.colors.surface.secondary, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: t.colors.text.primary, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>{detail}</Text>
      </View>
      <Ionicons name={chevron as any} size={18} color={t.colors.text.tertiary} />
    </TouchableOpacity>
  );

  const pickById = () => {
    if (!parsed) return;
    onPickAsset({ asset_id: parsed, ticker: 'RGB', name: shortContractId(parsed) });
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Receive an RGB asset" subtitle={`Received on-chain into ${accountLabel}`}>
      <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: t.spacing[2], paddingBottom: t.spacing[2] }}>
        {row('any', <RgbIcon size={22} />, 'Any RGB asset', 'The sender chooses the asset. Use this for one you don’t hold yet.', () => { onPickAny(); onClose(); })}
        {row('id', <Ionicons name="key-outline" size={20} color={t.colors.text.secondary} />, 'A specific asset', 'Only accepts the asset with this contract ID', () => setById(!byId), byId ? 'chevron-up' : 'chevron-down')}
        {byId && <View style={{ gap: t.spacing[2] }}>
          <Input
            accessibilityLabel="Contract ID"
            placeholder="rgb:…"
            value={contractId}
            onChangeText={setContractId}
            autoCapitalize="none"
            autoCorrect={false}
            error={contractId.trim() && !parsed ? 'This isn’t an RGB contract ID. It starts with rgb:' : undefined}
          />
          <Button title="Receive this asset" onPress={pickById} disabled={!parsed} fullWidth />
        </View>}
        {held.length > 0 && <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: t.spacing[2] }}>
          Assets you hold
        </Text>}
        {held.map(asset => row(asset.asset_id,
          <AssetIcon ticker={asset.ticker} protocol="RGB" size={22} showBadge={false} />,
          asset.ticker || asset.name, asset.name && asset.name !== asset.ticker ? asset.name : shortContractId(asset.asset_id),
          () => { onPickAsset(asset); onClose(); }))}
      </ScrollView>
    </Sheet>
  );
}
