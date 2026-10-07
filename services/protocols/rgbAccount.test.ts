import { chooseRgbBacking, isRgbNode, rgbNetworkLabel, rgbOnDeviceStep } from './rgbAccount';

const adapter = (connected: boolean, type?: 'ln' | 'rln') => ({ isConnected: () => connected, ...(type ? { walletType: () => type } : {}) });

test('only a connected RGB Lightning Node counts as the RGB node', () => {
  expect(isRgbNode(adapter(true, 'rln'))).toBe(true);
  expect(isRgbNode(adapter(true))).toBe(true); // the HTTP node adapter has no wallet type
  expect(isRgbNode(adapter(true, 'ln'))).toBe(false); // a plain Lightning wallet over NWC
  expect(isRgbNode(adapter(false, 'rln'))).toBe(false);
  expect(isRgbNode(null)).toBe(false);
  expect(isRgbNode(undefined)).toBe(false);
});

test('the RGB node wins, else RGB on this phone, else the node slot', () => {
  expect(chooseRgbBacking(true, true)).toBe('RGB_LN');
  expect(chooseRgbBacking(true, false)).toBe('RGB_LN');
  expect(chooseRgbBacking(false, true)).toBe('RGB_L1');
  expect(chooseRgbBacking(false, false)).toBe('RGB_LN');
});

test('RGB on this phone is released while an RGB node is the RGB account or when it is off', () => {
  expect(rgbOnDeviceStep({ enabled: false, nodeIsRgb: false, connected: true })).toBe('release');
  expect(rgbOnDeviceStep({ enabled: true, nodeIsRgb: true, connected: true })).toBe('release');
  expect(rgbOnDeviceStep({ enabled: true, nodeIsRgb: false, connected: true })).toBe('keep');
  expect(rgbOnDeviceStep({ enabled: true, nodeIsRgb: false, connected: false })).toBe('start');
});

test('network names read the same whoever reports them', () => {
  expect(rgbNetworkLabel('bitcoin')).toBe('Mainnet');
  expect(rgbNetworkLabel('mainnet')).toBe('Mainnet');
  expect(rgbNetworkLabel('signet')).toBe('Mutinynet');
  expect(rgbNetworkLabel('mutinynet')).toBe('Mutinynet');
  expect(rgbNetworkLabel('regtest')).toBe('Regtest');
  expect(rgbNetworkLabel('unknown')).toBeNull();
  expect(rgbNetworkLabel(undefined)).toBeNull();
});
