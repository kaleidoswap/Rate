// Development-only fixture: seed an EMPTY simulator with one Mutinynet account.
// This entry is never imported by index.ts or a Release bundle. No funds move here.
import 'react-native-get-random-values';
import { Buffer } from 'buffer';
import React, { useEffect, useState } from 'react';
import { Text, ScrollView, Platform } from 'react-native';
import { registerRootComponent } from 'expo';
import * as Crypto from 'expo-crypto';
import * as FS from 'expo-file-system/legacy';
global.Buffer = Buffer;
async function setup() {
  if (!__DEV__) throw Error('Only development simulators may prepare this fixture');
  const { default: DatabaseService } = require('../../services/DatabaseService');
  const { saveAccountPreferences } = require('../../services/protocols/accountChoices');
  const { buildNetworkConfig } = require('../../services/protocols/networkConfig');
  const db = DatabaseService.getInstance();
  await db.initializeDatabase();
  const name = `Rate ${Platform.OS} maker QA`;
  const wallets = await db.getAllWallets();
  if (wallets.some(w => w.name !== name)) throw Error('Refusing to alter a simulator with another wallet');
  let wallet = wallets.find(w => w.name === name);
  if (!wallet) {
    const mnemonic = require('bip39').entropyToMnemonic(Buffer.from(Crypto.getRandomBytes(16)));
    await saveAccountPreferences(mnemonic, { spark: false, arkade: true, bark: false, rgbOnDevice: false });
    const id = await db.createWallet({ name, created_at: Date.now(), is_active: true, encrypted_mnemonic: mnemonic }, [
      { type: 'arkade', enabled: true, config: buildNetworkConfig('arkade', 'signet') },
    ]);
    wallet = await db.getWallet(id);
  }
  if (wallet.networks?.length !== 1 || wallet.networks[0].type !== 'arkade' || JSON.parse(wallet.networks[0].config).network !== 'signet') throw Error('QA network mismatch');
  return { platform: Platform.OS, name, walletId: wallet.id, network: 'mutinynet', fundsSent: false, restored: wallets.length > 0 };
}
function Setup() {
  const [status, setStatus] = useState('Preparing isolated simulator wallet…');
  useEffect(() => { setup().then(async result => {
    await FS.writeAsStringAsync(FS.documentDirectory + 'rate-native-ui-setup.json', JSON.stringify({ passed: true, ...result }, null, 2));
    setStatus('Mutinynet wallet ready. Open the normal app to test swaps.');
  }).catch(async e => {
    await FS.writeAsStringAsync(FS.documentDirectory + 'rate-native-ui-setup.json', JSON.stringify({ passed: false, error: e.message }));
    setStatus(e.message);
  }); }, []);
  return <ScrollView contentContainerStyle={{ padding: 40 }}><Text>{status}</Text></ScrollView>;
}
registerRootComponent(Setup);
