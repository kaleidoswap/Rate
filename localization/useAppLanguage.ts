import { useAppSelector } from '../store/hooks';
import { resolveAppLanguage, translate } from './language';
export function useAppLanguage() {
  const preference = useAppSelector(state => state.settings?.language ?? 'system');
  const language = resolveAppLanguage(preference);
  return { language, preference, t: (text: string) => translate(language, text) };
}
