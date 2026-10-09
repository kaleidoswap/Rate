import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/ThemeProvider';
import { Sheet } from '../Sheet';
import { Callout } from '../Callout';
import { Button } from '../Button';
import { Input } from '../Input';
import { CopyButton } from '../CopyButton';
import { SegmentedTabs } from '../SegmentedTabs';
import { feedback } from '../../utils/feedback';
import { formatAssetAmount } from '../../utils/assetAmount';
import { listRgbUtxos, shortContractId, summarizeUtxos } from '../../utils/rgb-receive';
import {
  rgbWalletErrorMessage, rgbWalletSupport, validateRgbIssue, type RgbIssueInput, type RgbIssueSchema,
} from '../../utils/rgb-wallet';
import { issueRgbAsset, type IssuedRgbAsset } from '../../services/rgbWallet';
import { rgbAccountAdapter } from '../../services/protocols';

const SCHEMA_LABEL: Record<RgbIssueSchema, string> = { NIA: 'Token', CFA: 'Collectible' };
const SCHEMA_HINT: Record<RgbIssueSchema, string> = {
  NIA: 'A fungible token with a ticker, like a stablecoin or points. Non-inflatable: the supply is fixed at issuance.',
  CFA: 'A fungible asset with a name and a description instead of a ticker, for editions or collections. Fixed supply.',
};
const EMPTY: Omit<RgbIssueInput, 'schema'> = { ticker: '', name: '', details: '', precision: '0', amount: '' };
const grouped = (s: string) => {
  const [int, frac] = s.split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac !== undefined ? `.${frac}` : '');
};

/** Issue a new RGB asset in the RGB account, with the schemas it supports. */
export function IssueAssetSheet({ visible, onClose, adapter: given, onIssued, onCreateUtxos, onViewAsset }: {
  visible: boolean;
  onClose: () => void;
  adapter?: unknown;
  /** After an issuance: refresh the asset list. */
  onIssued?: (asset: IssuedRgbAsset) => void;
  /** Opens UTXO management when there is no free colorable UTXO. */
  onCreateUtxos?: () => void;
  onViewAsset?: (asset: IssuedRgbAsset) => void;
}) {
  const t = useAppTheme();
  const adapter: any = given ?? rgbAccountAdapter();
  const support = rgbWalletSupport(adapter);
  const schemas = support.issue;
  const [schema, setSchema] = useState<RgbIssueSchema>(schemas[0] ?? 'NIA');
  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState(false);
  const [freeUtxos, setFreeUtxos] = useState<number | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedRgbAsset | null>(null);

  useEffect(() => {
    if (!visible) return;
    setForm(EMPTY); setTouched(false); setError(null); setIssued(null); setSchema(schemas[0] ?? 'NIA');
    setFreeUtxos(null);
    if (support.listUtxos) {
      listRgbUtxos(adapter).then(list => setFreeUtxos(summarizeUtxos(list).free.length), () => setFreeUtxos(null));
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const { errors, request } = validateRgbIssue({ schema, ...form });
  const set = (key: keyof typeof EMPTY) => (value: string) => setForm(f => ({ ...f, [key]: value }));
  const shown = (key: keyof typeof errors) => (touched || form[key as keyof typeof EMPTY] !== EMPTY[key as keyof typeof EMPTY]) ? errors[key] : undefined;
  const unit = schema === 'NIA' ? (form.ticker.trim().toUpperCase() || 'tokens') : (form.name.trim() || 'units');
  const preview = request ? `${grouped(formatAssetAmount(request.amounts[0], request.precision))} ${unit}` : null;

  const submit = () => {
    setTouched(true);
    if (!request) { feedback.error(); return; }
    feedback.select();
    Alert.alert(
      `Issue ${preview}?`,
      'The asset is created in your RGB wallet and the whole supply is yours. The supply can’t be changed later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Issue', onPress: async () => {
            setIssuing(true);
            setError(null);
            try {
              const asset = await issueRgbAsset(adapter, request);
              feedback.success();
              setIssued(asset);
              onIssued?.(asset);
            } catch (e) {
              setError(rgbWalletErrorMessage(e, 'issue'));
            } finally {
              setIssuing(false);
            }
          },
        },
      ],
    );
  };

  if (schemas.length === 0) {
    return (
      <Sheet visible={visible} onClose={onClose} title="Issue an asset">
        <Callout tone="info" message="Your RGB node can’t issue assets over this connection. Issue them on the node, or use RGB on this phone." />
      </Sheet>
    );
  }

  if (issued) {
    return (
      <Sheet visible={visible} onClose={onClose} title="Asset issued"
        footer={<View style={{ gap: t.spacing[2], paddingTop: t.spacing[3] }}>
          {onViewAsset && <Button title="View asset" onPress={() => onViewAsset(issued)} />}
          <Button title="Done" variant="secondary" onPress={onClose} />
        </View>}>
        <View style={{ alignItems: 'center', gap: t.spacing[2], paddingVertical: t.spacing[3] }}>
          <Ionicons name="checkmark-circle" size={44} color={t.colors.success[500]} />
          <Text style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.xl, fontWeight: '700' }}>
            {grouped(formatAssetAmount(issued.supply, issued.precision))} {issued.ticker}
          </Text>
          <Text style={{ color: t.colors.text.secondary }}>{issued.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] }}>
            <Text style={{ color: t.colors.text.secondary, fontFamily: t.typography.fontFamily.mono, fontSize: t.typography.fontSize.xs }}>{shortContractId(issued.assetId)}</Text>
            <CopyButton value={issued.assetId} size={14} />
          </View>
          <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.sm, textAlign: 'center' }}>
            It’s in your asset list. Share the asset ID so others can receive it.
          </Text>
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} tall title="Issue an asset" subtitle="A new RGB asset, issued on-chain"
      footer={<View style={{ paddingTop: t.spacing[3] }}>
        <Button title={preview ? `Issue ${preview}` : 'Issue asset'} onPress={submit} loading={issuing} disabled={issuing || freeUtxos === 0} />
      </View>}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: t.spacing[3], paddingBottom: t.spacing[3] }}>
        {schemas.length > 1 && <SegmentedTabs<RgbIssueSchema> scrollable={false} fill value={schema} onChange={setSchema}
          options={schemas.map(s => ({ key: s, label: `${SCHEMA_LABEL[s]} (${s})` }))} />}
        <Text style={{ color: t.colors.text.secondary, fontSize: t.typography.fontSize.sm }}>{SCHEMA_HINT[schema]}</Text>

        {freeUtxos === 0 && <Callout tone="warning" title="Needs a free colorable UTXO"
          message={support.createUtxos ? 'The new asset is placed on a free colorable UTXO. Create some, wait for them to confirm, then issue.' : 'The new asset is placed on a free colorable UTXO, and there is none.'}>
          {support.createUtxos && onCreateUtxos && <Button title="Create UTXOs" variant="secondary" size="sm" onPress={onCreateUtxos} style={{ marginTop: t.spacing[2] }} />}
        </Callout>}

        {schema === 'NIA' && <Input label="Ticker" placeholder="e.g. PTS" autoCapitalize="characters" autoCorrect={false} maxLength={8}
          value={form.ticker} onChangeText={set('ticker')} error={shown('ticker')} accessibilityLabel="Ticker" />}
        <Input label="Name" placeholder={schema === 'NIA' ? 'e.g. Loyalty Points' : 'e.g. Genesis Edition'} maxLength={40}
          value={form.name} onChangeText={set('name')} error={shown('name')} accessibilityLabel="Name" />
        {schema === 'CFA' && <Input label="Description (optional)" placeholder="What it represents" multiline maxLength={255}
          value={form.details} onChangeText={set('details')} error={shown('details')} accessibilityLabel="Description" />}
        <View style={{ flexDirection: 'row', gap: t.spacing[3] }}>
          <View style={{ flex: 2 }}>
            <Input label="Supply" placeholder="1000000" keyboardType="decimal-pad"
              value={form.amount} onChangeText={set('amount')} error={shown('amount')} accessibilityLabel="Supply" />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Decimals" placeholder="0" keyboardType="number-pad" maxLength={2}
              value={form.precision} onChangeText={set('precision')} error={shown('precision')} accessibilityLabel="Decimals" />
          </View>
        </View>
        <Text style={{ color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs }}>
          Decimals set the smallest amount: 2 decimals lets you send 0.01. They can’t be changed later.
        </Text>
        {preview && <Text style={{ color: t.colors.text.primary, fontSize: t.typography.fontSize.sm }}>You’ll hold {preview}.</Text>}
        {!!error && <Callout tone="error" message={error} />}
      </ScrollView>
    </Sheet>
  );
}
