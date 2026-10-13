import { getAppLanguage } from '../localization/language';
import { prismoText } from '../localization/prismo';
import type { FunnelResult } from '@kaleidorg/mind';

/** Translate only core-generated templates. Never rewrite model output, addresses or tool payloads. */
export function localizePrismoReply(result: FunnelResult): FunnelResult {
  if (getAppLanguage() !== 'it' || (result.tier !== 'fast' && result.tier !== 'recipe')) return result;
  let text = prismoText(result.text);
  if (result.tier === 'fast') {
    text = text.replace(/^You have (.+?)(?: across (\d+) layers)?\.$/, (_, amount, layers) => `Hai ${amount}${layers ? ` su ${layers} reti` : ''}.`)
      .replace(/^Here's your receive address:/, 'Ecco il tuo indirizzo di ricezione:')
      .replace(/^No address available right now\.$/, 'Nessun indirizzo disponibile al momento.')
      .replace(/^Bitcoin is \$(.+)\.$/, 'Il prezzo di Bitcoin è $\u00241.')
      .replace(/^You don't hold any RGB assets yet\.$/, 'Non hai ancora asset RGB.')
      .replace(/^Your RGB assets:/, 'I tuoi asset RGB:')
      .replace(/^Balances:/, 'Saldi:')
      .replace(/ spendable\./g, ' disponibili.')
      .replace(/\(holding RGB assets, not for spending\)/g, '(contengono asset RGB, non disponibili per la spesa)')
      .replace(/balance unknown/g, 'saldo non disponibile')
      .replace(/ in channels/g, ' nei canali');
  } else {
    text = text.replace(/^Sent (.+) sats to (.+)\.$/, 'Inviati $1 sats a $2.')
      .replace(/^Payment sent to (.+)\.$/, 'Pagamento inviato a $1.')
      .replace(/^Here's your (.+?) invoice for (.+?):/, 'Ecco la richiesta di pagamento $1 per $2:')
      .replace(/^Created an invoice for (.+)\.$/, 'Creata una richiesta di pagamento per $1.')
      .replace(/any amount/g, 'qualsiasi importo')
      .replace(/^Couldn't complete that: /, 'Impossibile completare la richiesta: ');
  }
  return { ...result, text };
}
