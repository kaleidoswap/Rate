// The assistant's paid-service tools. `fetch_paid_resource` runs the L402 flow
// (402 challenge → pay the invoice from the Agent wallet → retry with the proof)
// and `agent_budget_status` reports what is left to spend. Everything a
// service sends back is untrusted: it only ever reaches the payment gate as an
// invoice and an announced amount, never as rules.

import type { ToolDef, ToolSource } from '@kaleidorg/mind';
import { payFromAgentWallet, type AgentPayConfirmation, type AgentPayDeps } from './agentPay';
import { normalizeService } from './policy';
import type { AgentWalletStore } from './store';
import { reconcileAgentWallet } from './reconcile';

export const PAID_RESOURCE_TOOL = 'fetch_paid_resource';
export const BUDGET_TOOL = 'agent_budget_status';

const MAX_BODY_CHARS = 8000;
const FETCH_TIMEOUT_MS = 20_000;

export interface AgentToolDeps {
  payDeps: () => Promise<Pick<AgentPayDeps, 'store' | 'wallet'>>;
  /** Asks the user through the assistant's confirm sheet; undefined when no one can be asked. */
  confirm: () => ((c: AgentPayConfirmation) => Promise<boolean>) | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface L402Challenge {
  scheme: 'L402' | 'LSAT';
  macaroon: string;
  invoice: string;
}

export function parseL402Challenge(header: string | null | undefined): L402Challenge | null {
  const text = String(header ?? '');
  const m = text.match(/\b(L402|LSAT)\s+([^]*)$/i);
  if (!m) return null;
  const params = m[2];
  const macaroon = params.match(/\b(?:macaroon|token)="([^"]+)"/i)?.[1];
  const invoice = params.match(/\binvoice="([^"]+)"/i)?.[1];
  if (!macaroon || !invoice || !/^[A-Za-z0-9+/=_-]+$/.test(macaroon)) return null;
  return { scheme: m[1].toUpperCase() as 'L402' | 'LSAT', macaroon, invoice: invoice.trim() };
}

/** The amount a service announced alongside its invoice, if it announced one. */
async function announcedSats(res: Response): Promise<number | undefined | null> {
  const header = res.headers.get('x-amount-sats') ?? res.headers.get('x-price-sats');
  let body: any;
  try { body = JSON.parse(await res.text()); } catch { body = undefined; }
  const fromBody = body && typeof body === 'object' ? body.amount_sats ?? body.price_sats : undefined;
  const values = [header, fromBody].filter((v) => v != null && v !== '').map(Number);
  if (!values.length) return undefined;
  if (values.some((v) => !Number.isInteger(v) || v <= 0) || new Set(values).size > 1) return null;
  return values[0];
}

function checkUrl(raw: unknown): URL {
  let url: URL;
  try { url = new URL(String(raw ?? '').trim()); } catch { throw new Error('Give the full https:// address of the resource.'); }
  if (url.protocol !== 'https:') throw new Error('Only https:// resources can be paid for.');
  if (url.username || url.password) throw new Error('Addresses with a user name or password are not supported.');
  return url;
}

async function timedFetch(fetchImpl: typeof fetch, url: string, init?: RequestInit): Promise<Response> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    return await fetchImpl(url, { ...init, ...(controller ? { signal: controller.signal } : {}) });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = (await res.text()).slice(0, MAX_BODY_CHARS);
  try { return JSON.parse(text); } catch { return text; }
}

const sameHost = (res: Response, host: string) => !res.url || normalizeService(res.url) === host;

async function fetchPaid(args: Record<string, unknown>, deps: AgentToolDeps): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = checkUrl(args.url);
  const service = normalizeService(url.href);
  if (!service) throw new Error('That address has no valid host.');

  const first = await timedFetch(fetchImpl, url.href);
  if (first.status !== 402) {
    if (!first.ok) throw new Error(`The service answered ${first.status}.`);
    return { paid_sats: 0, data: await readBody(first) };
  }
  if (!sameHost(first, service)) throw new Error('The payment request came from a different site than the one asked for, so nothing was paid.');
  const challenge = parseL402Challenge(first.headers.get('www-authenticate'));
  if (!challenge) throw new Error('The service asked for payment in a way this app does not support (no L402 invoice).');
  const announced = await announcedSats(first);
  if (announced === null) throw new Error('The service announced an unclear price, so nothing was paid.');

  const paid = await payFromAgentWallet(
    { invoice: challenge.invoice, service, reason: PAID_RESOURCE_TOOL, ...(announced !== undefined ? { expectedSats: announced } : {}) },
    { ...(await deps.payDeps()), confirm: deps.confirm(), now: deps.now },
  );
  if (!paid.ok) throw new Error(`Not paid: ${paid.reason}`);

  const second = await timedFetch(fetchImpl, url.href, {
    headers: { Authorization: `${challenge.scheme} ${challenge.macaroon}:${paid.preimage}` },
  }).catch((e) => {
    throw new Error(`Paid ${paid.amountSats} sats, but the service could not be reached afterwards (${e instanceof Error ? e.message : 'network error'}).`);
  });
  if (!second.ok) throw new Error(`Paid ${paid.amountSats} sats, but the service answered ${second.status} afterwards.`);
  return { paid_sats: paid.amountSats, fee_sats: paid.feeSats, service, data: await readBody(second) };
}

export async function budgetStatus(store: AgentWalletStore | null, balance: () => Promise<number>, now = Date.now()): Promise<unknown> {
  if (!store || !(await store.isEnabled())) {
    return { enabled: false, message: 'The Agent wallet is off. The user can turn it on in Settings, KaleidoMind, Agent wallet.' };
  }
  const policy = await store.loadPolicy();
  if (!policy) return { enabled: true, usable: false, message: "The Agent wallet's spending rules could not be read, so it will not pay." };
  const totals = await store.totals(now);
  const balanceSats = await balance().catch(() => null);
  return {
    enabled: true,
    paused: policy.paused,
    balance_sats: balanceSats,
    per_payment_limit_sats: policy.perPaymentSats,
    spent_today_sats: totals.todaySats,
    left_today_sats: Math.max(0, policy.dailySats - totals.todaySats),
    spent_this_month_sats: totals.monthSats,
    left_this_month_sats: Math.max(0, policy.monthlySats - totals.monthSats),
    pays_without_asking_below_sats: policy.autoApproveSats,
    allowed_services: policy.allowedServices,
  };
}

const TOOLS: ToolDef[] = [
  {
    name: PAID_RESOURCE_TOOL,
    description:
      'Fetch a paid (HTTP 402 / L402) resource the user asked for. Pays its Lightning invoice from the Agent wallet ' +
      "within the user's limits (asks the user when the rules say so) and returns the data. Pass the full https URL. " +
      'If it says "Not paid", tell the user why; do not retry.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The https URL of the resource' } },
      required: ['url'],
    },
    requiresConfirmation: false,
  },
  {
    name: BUDGET_TOOL,
    description: "Read the Agent wallet: whether it is on, its balance, and what is left of today's and this month's limits. Read-only.",
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: false,
  },
];

export function buildAgentToolSource(deps: AgentToolDeps): ToolSource {
  return {
    id: 'agent-wallet',
    listTools: () => TOOLS,
    has: (name) => TOOLS.some((t) => t.name === name),
    async execute(name, args) {
      if (name === PAID_RESOURCE_TOOL) return fetchPaid(args ?? {}, deps);
      if (name === BUDGET_TOOL) {
        const { store, wallet } = await deps.payDeps();
        if (store && wallet) await reconcileAgentWallet(store, wallet, (deps.now ?? Date.now)());
        return budgetStatus(store, () => (wallet ? wallet.balanceSats() : Promise.reject(new Error('unavailable'))), (deps.now ?? Date.now)());
      }
      throw new Error(`Unknown tool ${name}`);
    },
  };
}
