import { getAppLanguage, translate } from './language';
export function prismoText(text: string): string { if (getAppLanguage() !== 'it') return text;
  return translate('it', text).replace(/^Downloading AI model… (.*)$/, 'Scaricamento modello… $1').replace(/^Downloading on-device AI… (.*)$/, 'Scaricamento modello… $1').replace(/^Downloading speech recognition… (.*)$/, 'Scaricamento riconoscimento vocale… $1'); }
