import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { RecordField } from '../ui/lists';
import { Surface, Collapsible } from '../ui/surfaces';
import { Typography } from '../ui/typography';
import { useAppTheme } from '../../theme/ThemeProvider';
import { useAppLanguage } from '../../localization/useAppLanguage';
import { protocolManager } from '../../services/protocols';
import { rgbLibSchemas } from '../../services/protocols/rgbLibRn';
import { installedRgbLibVersion, type RgbL1Network } from '../../services/protocols/rgbL1';
import type { RgbNodeSummary } from '../RgbAccountSettings';

interface Props {
  onDevice: boolean;
  phoneNetwork: RgbL1Network | null;
  node: RgbNodeSummary;
}

function relayHosts(relays: string[] = []): string[] {
  const hosts = new Set<string>();
  for (const relay of relays) {
    try {
      const url = new URL(relay);
      if (url.protocol === 'wss:' || url.protocol === 'ws:') hosts.add(url.host);
    } catch { /* Older saved connections can contain invalid relay URLs. */ }
  }
  return [...hosts];
}

function ValidationFields({ onDevice, phoneNetwork, node }: Props) {
  const theme = useAppTheme();
  const { t } = useAppLanguage();
  const [nodeInfo, setNodeInfo] = useState<Record<string, unknown> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (onDevice || !node.connected) return;
    let current = true;
    async function readNode() {
      try {
        const adapter = protocolManager.getAdapterIfAvailable('RGB_LN');
        if (!adapter?.isConnected()) throw new Error();
        const info = await adapter.getNodeInfo();
        if (current) setNodeInfo(info);
      } catch {
        if (current) setFailed(true);
      }
    }
    void readNode();
    return () => { current = false; };
  }, [onDevice, node.connected]);

  const rows: [string, string][] = [];
  if (onDevice) {
    const version = installedRgbLibVersion();
    rows.push(['Wallet library', version ? `rgb-lib ${version}` : t('rgb-lib · version unavailable')]);
    if (phoneNetwork) rows.push(['Wallet schemas', rgbLibSchemas(phoneNetwork).join(', ')]);
    rows.push(['Contract data', t('Private app storage on this phone')]);
  } else {
    rows.push(['Wallet backend', 'rgb-lightning-node']);
    rows.push(['Connection', node.transport === 'http' ? 'HTTP RPC' : 'Nostr Wallet Connect (NIP-47)']);
    rows.push(['Indexer and RGB proxy', t('Configured on your node')]);
    if (node.connected) {
      const hosts = relayHosts(node.relays);
      if (hosts.length) rows.push(['Nostr relays', hosts.join('\n')]);
      if (typeof nodeInfo?.pubkey === 'string' && nodeInfo.pubkey) rows.push(['Node public key', nodeInfo.pubkey]);
      if (typeof nodeInfo?.num_channels === 'number') rows.push(['Lightning channels', String(nodeInfo.num_channels)]);
      if (typeof nodeInfo?.max_media_upload_size_mb === 'number') rows.push(['Media upload limit', `${nodeInfo.max_media_upload_size_mb} MB`]);
    }
  }

  return (
    <View style={{ gap: theme.spacing[3] }}>
      <Typography role="caption" muted>
        {t(onDevice
          ? 'This phone checks the contract history in each consignment against its Bitcoin anchors. The RGB proxy delivers consignments between wallets.'
          : 'Your RGB node checks each consignment against the contract rules and Bitcoin anchors, keeps the contract history and reports asset balances to this phone.')}
      </Typography>
      {rows.map(([label, value]) => <RecordField key={label} label={t(label)} value={value} />)}
      {!onDevice && node.connected && !nodeInfo && <Typography role="caption" muted accessibilityLiveRegion="polite">
        {t(failed ? 'Node details unavailable. Reopen to retry.' : 'Reading node details…')}
      </Typography>}
    </View>
  );
}

export function RgbValidationDetails(props: Props) {
  const theme = useAppTheme();
  const { t } = useAppLanguage();
  return (
    <Surface style={{ paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[1] }}>
      <Collapsible title={t('Client-side validation')}>
        <ValidationFields {...props} />
      </Collapsible>
    </Surface>
  );
}
