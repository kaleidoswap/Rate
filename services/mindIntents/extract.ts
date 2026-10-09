// Text → intent. Rules first; the on-device model only fills what the rules
// could not, and only through the schema validator.

import { parseIntentRules, normalizeIntentText } from './parse';
import { extractJsonObject, INTENT_JSON_SCHEMA, validateIntent, type IntentResult, type MindIntent } from './schema';
import type { LocalTextModel } from './model';

export const INTENT_SYSTEM_PROMPT =
  'You turn one wallet request into JSON. Reply with a single JSON object that ' +
  'matches this JSON Schema, and nothing else. Use null for anything the user ' +
  'did not say. Copy numbers and names exactly as the user wrote them; never ' +
  'compute, convert or guess values.\n' +
  `Schema: ${JSON.stringify(INTENT_JSON_SCHEMA)}`;

function merge(rules: MindIntent | undefined, model: MindIntent): MindIntent {
  if (!rules || rules.kind !== model.kind) return rules ?? model;
  return { ...model, ...stripUndefined(rules) };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export async function extractIntent(text: string, model?: LocalTextModel | null): Promise<IntentResult | null> {
  const rules = parseIntentRules(text);
  if (rules?.confident || !model?.ready()) return rules;
  const normalized = normalizeIntentText(text);
  try {
    const reply = await model.complete(INTENT_SYSTEM_PROMPT, normalized, { maxTokens: 160 });
    const validated = validateIntent(extractJsonObject(reply), normalized);
    if (!validated) return rules;
    return { intent: merge(rules?.intent, validated), source: 'model', confident: false };
  } catch {
    return rules;
  }
}
