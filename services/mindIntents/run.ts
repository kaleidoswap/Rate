import { buildActionCard, type ActionCard, type CardDeps } from './card';
import { extractIntent } from './extract';
import { answerBalance, answerSpending, type AnswerCard, type BalanceInput } from './questions';
import type { LocalTextModel } from './model';
import type { IntentResult } from './schema';
import type { ActivityItem } from '../ActivityService';

export type IntentOutcome =
  | { type: 'action'; card: ActionCard; result: IntentResult }
  | { type: 'answer'; answer: AnswerCard; result: IntentResult }
  | { type: 'none'; message: string };

export interface RunIntentDeps {
  model?: LocalTextModel | null;
  card: CardDeps;
  balance: () => BalanceInput;
  activity: () => Promise<ActivityItem[]>;
}

export const NOT_UNDERSTOOD =
  'Try something like “send 10€ to Mario”, “swap half my BTC to USDT”, “receive 50k sats on Lightning” or “how much did I spend this week”.';

export async function runIntent(text: string, deps: RunIntentDeps): Promise<IntentOutcome> {
  const result = await extractIntent(text, deps.model);
  if (!result) {
    return { type: 'none', message: deps.model?.ready() ? NOT_UNDERSTOOD : `${NOT_UNDERSTOOD} Turn on KaleidoMind for anything else.` };
  }
  const { intent } = result;
  if (intent.kind === 'balance') return { type: 'answer', answer: answerBalance(intent, deps.balance()), result };
  if (intent.kind === 'spending') return { type: 'answer', answer: answerSpending(intent, await deps.activity()), result };
  const card = await buildActionCard(intent, deps.card);
  return card ? { type: 'action', card, result } : { type: 'none', message: NOT_UNDERSTOOD };
}
