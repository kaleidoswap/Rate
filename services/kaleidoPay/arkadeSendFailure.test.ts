jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import AsyncStorage from '@react-native-async-storage/async-storage';
import { arkadeFailureCode, arkadeSendFailure, recordArkadeSendFailure, readArkadeSendFailure } from './arkadeSendFailure';
it('does not infer expiry from a generic VTXO error', () => {
  expect(arkadeFailureCode(new Error('Failed to get vtxos'))).toBe('inputs');
  expect(arkadeSendFailure(new Error('Failed to get vtxos'))).not.toMatch(/renewal|recovery/);
  expect(arkadeFailureCode(new Error('missing annotation for virtual coin secret-outpoint'))).toBe('annotation');
  expect(arkadeFailureCode(new Error('vtxo already spent'))).toBe('spent');
});
it('persists only fixed diagnostics, never raw provider data', async () => {
  await recordArkadeSendFailure('test', new Error('vtxo already spent: private-address signed-transaction'));
  const result = await readArkadeSendFailure('test');
  expect(result).toMatchObject({ stage: 'send', code: 'spent' });
  expect(JSON.stringify(result)).not.toMatch(/private-address|signed-transaction/);
  await AsyncStorage.setItem('arkade-send-diagnostic:bad', JSON.stringify({ code: 'raw secret', stage: 'send', recordedAt: 1 }));
  expect(await readArkadeSendFailure('bad')).toBeUndefined();
});
