import { getAppLanguage, resolveAppLanguage, translate } from './language';
import { getStore } from '../store/storeProvider';
jest.mock('../store/storeProvider', () => ({ getStore: jest.fn() }));
it('follows the system locale or the explicit app choice', () => {
  expect(resolveAppLanguage('system', 'it_IT')).toBe('it');
  expect(resolveAppLanguage('en', 'it-IT')).toBe('en');
  expect(resolveAppLanguage('it', 'en-US')).toBe('it');
  expect(resolveAppLanguage('system', 'ja-JP')).toBe('en');
});
it('reads the current persisted preference each time for QVAC', () => {
  let language = 'it';
  (getStore as jest.Mock).mockReturnValue({ getState: () => ({ settings: { language } }) });
  expect(getAppLanguage()).toBe('it'); language = 'en'; expect(getAppLanguage()).toBe('en');
});
it('translates navigation and falls back for untranslated text', () => {
  expect(translate('it', 'Activity')).toBe('Attività');
  expect(translate('en', 'Activity')).toBe('Activity');
  expect(translate('it', 'Spark')).toBe('Spark');
});
