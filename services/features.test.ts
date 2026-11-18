import { HELD_FEATURES, LABS_FEATURES, isAvailable, isFeatureOn, parseChannel } from './features';
import reducer, { selectFeatureOn, setLabsFeature } from '../store/slices/settingsSlice';

test('an unknown or missing channel is a development build', () => {
  expect(parseChannel(undefined)).toBe('dev');
  expect(parseChannel('production')).toBe('dev');
  expect(parseChannel('beta')).toBe('beta');
  expect(parseChannel('store')).toBe('store');
});

test('a development build ships everything, with Labs features on', () => {
  for (const feature of [...LABS_FEATURES, ...HELD_FEATURES]) {
    expect(isAvailable(feature, 'dev')).toBe(true);
    expect(isFeatureOn(feature, undefined, 'dev')).toBe(true);
  }
});

test.each(['beta', 'store'] as const)('a %s build drops Held features and starts Labs features off', (channel) => {
  for (const feature of HELD_FEATURES) {
    expect(isAvailable(feature, channel)).toBe(false);
    expect(isFeatureOn(feature, undefined, channel)).toBe(false);
  }
  for (const feature of LABS_FEATURES) {
    expect(isAvailable(feature, channel)).toBe(true);
    expect(isFeatureOn(feature, undefined, channel)).toBe(false);
    expect(isFeatureOn(feature, { [feature]: true }, channel)).toBe(true);
  }
});

test('the user can turn a Labs feature off in a development build', () => {
  expect(isFeatureOn('prismo', { prismo: false }, 'dev')).toBe(false);
});

test('the settings slice records a Labs choice and the selector reads it', () => {
  const settings = reducer(undefined, setLabsFeature({ feature: 'map', enabled: false }));
  expect(settings.labs).toEqual({ map: false });
  expect(selectFeatureOn({ settings } as any, 'map')).toBe(false);
  expect(selectFeatureOn({ settings } as any, 'arkade')).toBe(true);
});

test('state persisted before Labs existed follows the build channel', () => {
  const settings = { ...reducer(undefined, { type: 'init' }), labs: undefined };
  expect(selectFeatureOn({ settings } as any, 'social')).toBe(true);
});
