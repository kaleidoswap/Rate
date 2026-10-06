import { fromEngineProtocol, setRgbBacking, toEngineProtocol } from './protocol-bridge';

test('the RGB account maps to whichever protocol backs it; others pass through', () => {
  expect(toEngineProtocol('RGB')).toBe('RGB_LN'); // default before the protocol layer says otherwise
  setRgbBacking(() => 'RGB_L1');
  expect(toEngineProtocol('RGB')).toBe('RGB_L1');
  expect(toEngineProtocol('SPARK')).toBe('SPARK');
  expect(fromEngineProtocol('RGB_L1')).toBe('RGB');
  expect(fromEngineProtocol('RGB_LN')).toBe('RGB');
  setRgbBacking(() => 'RGB_LN');
});
