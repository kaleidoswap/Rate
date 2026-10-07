/**
 * "You can send to": the destinations Send can pay, shown until something
 * payable is entered. Lists only what this wallet pays (no Liquid), plus USDC /
 * USDT to other chains when cross-chain sends are available, with the chains
 * Orchestra currently routes to from Spark (curated list as fallback).
 */
import React, { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useAppTheme } from '../../theme/ThemeProvider';
import { NetworkIcon } from '../NetworkIcon';
import { getRoutes, isOrchestraConfigured } from '../../services/orchestra/client';
import { CURATED_WITHDRAW_CHAINS, WITHDRAW_DEST_TOKENS, type CrossChainDestChain } from '../../utils/crosschain';
import { hintChains } from '../../utils/crosschain-send';
import { assetIcon, chainIcon } from '../../utils/orchestra-ui';

type Leg = 'lightning' | 'onchain' | 'spark' | 'arkade' | 'rgb';
const FORMATS: { network: Leg; name: string; formats: string }[] = [
  { network: 'lightning', name: 'Lightning', formats: 'Invoice · LNURL · Lightning address · BOLT12 offer' },
  { network: 'onchain', name: 'Bitcoin', formats: 'On-chain address' },
  { network: 'spark', name: 'Spark', formats: 'Spark address, in bitcoin or USDB' },
  { network: 'arkade', name: 'Arkade', formats: 'Ark address' },
  { network: 'rgb', name: 'RGB', formats: 'RGB invoice' },
];

export function SendDestinationsHint() {
  const t = useAppTheme();
  const crossChain = isOrchestraConfigured();
  const [chains, setChains] = useState<CrossChainDestChain[]>(CURATED_WITHDRAW_CHAINS);

  useEffect(() => {
    if (!crossChain) return;
    let live = true;
    getRoutes().then(routes => { if (live) setChains(hintChains(routes)); }).catch(() => { /* keep the curated list */ });
    return () => { live = false; };
  }, [crossChain]);

  const text = { color: t.colors.text.primary, fontSize: t.typography.fontSize.sm, fontWeight: '600' as const };
  const small = { color: t.colors.text.tertiary, fontSize: t.typography.fontSize.xs };
  const chip = (size: number) => ({ width: size, height: size, borderRadius: size / 2, alignItems: 'center' as const, justifyContent: 'center' as const });

  return (
    <View accessibilityLabel="You can send to" style={{ gap: t.spacing[3], padding: t.spacing[4], borderRadius: t.borderRadius.lg, backgroundColor: t.colors.surface.primary, borderWidth: 1, borderColor: t.colors.border.light }}>
      <View style={{ gap: 2 }}>
        <Text style={{ ...text, fontSize: t.typography.fontSize.base }}>You can send to</Text>
        <Text style={small}>Paste or scan any of these.</Text>
      </View>

      {FORMATS.map(f => (
        <View key={f.name} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3] }}>
          <View style={[chip(32), { backgroundColor: t.colors.networks[f.network] + '29' }]}><NetworkIcon network={f.network} size={18} /></View>
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={text}>{f.name}</Text>
            <Text style={small}>{f.formats}</Text>
          </View>
        </View>
      ))}

      {crossChain && chains.length > 0 && (
        <View accessibilityLabel={`USDC or USDT to ${chains.map(c => c.label).join(', ')}`}
          style={{ gap: t.spacing[2], padding: t.spacing[3], borderRadius: t.borderRadius.md, backgroundColor: t.colors.background.secondary }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3] }}>
            <View style={{ flexDirection: 'row', width: 32 }}>
              {WITHDRAW_DEST_TOKENS.map((token, i) => {
                const src = assetIcon(token);
                return src ? <Image key={token} source={src} style={{ width: 20, height: 20, borderRadius: 10, marginLeft: i ? -8 : 0, borderWidth: 1.5, borderColor: t.colors.background.secondary }} /> : null;
              })}
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={text}>{WITHDRAW_DEST_TOKENS.join(' / ')} to other chains</Text>
              <Text style={small}>EVM or Solana address, paid from your Spark balance</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: t.spacing[2], paddingLeft: 32 + t.spacing[3] }}>
            {chains.map(c => {
              const src = chainIcon(c.chain);
              return src
                ? <Image key={c.chain} accessibilityLabel={c.label} source={src} style={{ width: 22, height: 22, borderRadius: 11 }} />
                : <Text key={c.chain} style={small}>{c.label}</Text>;
            })}
          </View>
        </View>
      )}
    </View>
  );
}

export default SendDestinationsHint;
