import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { IProtocolAdapter, UnifiedAsset } from '@kaleidorg/wallet-engine';
import { protocolManager } from '../../services/protocols';
import { getRgbAssetMetadata } from '../../services/rgbWallet';
import { normalizeRgbAssetMetadata, RGB_SCHEMA_LABEL, type RgbAssetMetadata } from '../../utils/rgb-wallet';
import { formatSmallUnits } from '../../utils/orchestra-ui';
import { shortContractId } from '../../utils/rgb-receive';
import { useAppLanguage } from '../../localization/useAppLanguage';
import { useAppSelector } from '../../store/hooks';
import { useAppTheme } from '../../theme/ThemeProvider';
import { QueryState, RecordField } from '../ui/lists';
import { CodeBlock, Collapsible, Copyable, Surface } from '../ui/surfaces';
import { Typography } from '../ui/typography';

type Protocol = 'RGB_L1' | 'RGB_LN';

// A node can return u64 supplies as decimal strings. Keep those exact in JSON.
function contractUnits(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  return undefined;
}

function ContractDetails({ adapter, asset }: { adapter: IProtocolAdapter; asset: UnifiedAsset }) {
  const theme = useAppTheme();
  const { t } = useAppLanguage();
  const hideBalances = useAppSelector((state) => state.settings.hideBalances);
  const [metadata, setMetadata] = useState<RgbAssetMetadata | null>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    getRgbAssetMetadata(adapter, asset.id).then(
      (result) => {
        if (current) setMetadata(result);
      },
      () => {
        if (current) {
          setMetadata(null);
          setFailed(true);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [adapter, asset.id]);

  // Some NWC nodes provide contract fields only in their asset listing.
  const raw = asset.metadata;
  const listed = normalizeRgbAssetMetadata(raw);
  const precision = metadata?.precision ?? asset.precision;
  const data = {
    contractId: asset.id,
    schema: metadata?.schema ?? listed.schema,
    name: metadata?.name ?? asset.name,
    ticker: metadata?.ticker ?? asset.ticker,
    precision,
    details: metadata?.details ?? listed.details,
    issuedSupply: contractUnits(
      metadata?.issuedSupply ??
        raw?.known_circulating_supply ??
        raw?.issued_supply ??
        raw?.initial_supply ??
        listed.issuedSupply,
    ),
    maxSupply: contractUnits(metadata?.maxSupply ?? raw?.max_supply ?? listed.maxSupply),
    timestamp: metadata?.timestamp ?? listed.timestamp,
    mediaType: metadata?.media?.mime || listed.media?.mime || undefined,
  };
  return (
    <View style={{ gap: theme.spacing[2] }}>
      <Typography role="eyebrow" muted>
        {t('Contract ID')}
      </Typography>
      <Copyable value={asset.id} label={t('Copy contract ID')} />
      <RecordField label={t('Available')} value={hideBalances ? '••••' : asset.balance.availableDisplay} />
      <RecordField label={t('Total')} value={hideBalances ? '••••' : asset.balance.totalDisplay} />
      {data.schema && (
        <RecordField label={t('Schema')} value={t(RGB_SCHEMA_LABEL[data.schema] ?? data.schema)} />
      )}
      <RecordField label={t('Decimals')} value={String(precision)} />
      {data.issuedSupply != null && (
        <RecordField
          label={t('Issued supply')}
          value={precision <= 255 ? formatSmallUnits(String(data.issuedSupply), precision) : '—'}
        />
      )}
      {data.details && (
        <Typography role="caption" selectable>
          {data.details}
        </Typography>
      )}
      {metadata === undefined && (
        <Typography role="caption" muted>
          {t('Reading contract metadata…')}
        </Typography>
      )}
      {metadata === null && !failed && (
        <Typography role="caption" muted>
          {t('Showing metadata from the asset list.')}
        </Typography>
      )}
      {failed && (
        <Typography role="caption" muted>
          {t('Couldn’t read additional contract metadata. Reopen the asset to retry.')}
        </Typography>
      )}
      <Collapsible title={t('Asset metadata (JSON)')}>
        <CodeBlock code={JSON.stringify(data, null, 2)} label={t('Copy asset metadata')} />
      </Collapsible>
    </View>
  );
}

function WalletInventory({ protocol }: { protocol: Protocol }) {
  const { t } = useAppLanguage();
  const theme = useAppTheme();
  const hideBalances = useAppSelector((state) => state.settings.hideBalances);
  const [assets, setAssets] = useState<UnifiedAsset[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const adapter = protocolManager.getAdapterIfAvailable(protocol);
  useEffect(() => {
    let current = true;
    const load = async () => {
      if (!adapter?.isConnected()) throw new Error();
      const all = await adapter.listAssets();
      if (current) setAssets(all.filter((asset) => asset.layer === 'RGB_L1' || asset.layer === 'RGB_LN'));
    };
    setAssets(undefined);
    setFailed(false);
    void load().catch(() => {
      if (current) setFailed(true);
    });
    return () => {
      current = false;
    };
  }, [adapter, attempt]);

  return (
    <Surface style={{ paddingVertical: theme.spacing[1], paddingHorizontal: theme.spacing[3], gap: theme.spacing[1] }}>
      <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography accessibilityRole="header" role="body" style={{ fontWeight: '600' }}>{t('Wallet assets')}</Typography>
        {assets && <Pressable accessibilityRole="button" accessibilityLabel={t('Refresh assets')}
          onPress={() => setAttempt((n) => n + 1)}
          style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="refresh-outline" size={16} color={theme.colors.text.secondary} />
        </Pressable>}
      </View>
      <QueryState
        isLoading={!assets && !failed}
        error={failed && t('Couldn’t read assets from this wallet.')}
        loadingLabel={t('Reading wallet assets')}
        onRetry={() => setAttempt((n) => n + 1)}
      >
        {assets?.length === 0 && <Typography role="caption" muted>{t('No RGB assets in this wallet')}</Typography>}
        {adapter &&
          assets?.map((asset) => (
            <Collapsible
              key={asset.id}
              description={`${hideBalances ? '••••' : asset.balance.availableDisplay} ${asset.ticker} · ${shortContractId(asset.id)}`}
              title={asset.name === asset.ticker ? asset.name : `${asset.name} · ${asset.ticker}`}
            >
              <ContractDetails adapter={adapter} asset={asset} />
            </Collapsible>
          ))}
      </QueryState>
    </Surface>
  );
}

export function RgbWalletAssets({
  protocol,
  walletId,
  network,
}: {
  protocol: Protocol;
  walletId: number;
  network?: string;
}) {
  return <WalletInventory key={`${walletId}/${protocol}/${network ?? ''}`} protocol={protocol} />;
}
