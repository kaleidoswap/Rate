/**
 * Crash reporting (Sentry), opt-in.
 *
 * Off until the user turns on "Send crash reports" in Settings, and only in
 * builds that carry a DSN (EXPO_PUBLIC_SENTRY_DSN). Reports never carry wallet
 * data: no user, no request bodies, no console or network breadcrumbs, only
 * device and runtime contexts, and every string is scrubbed of keys, seeds,
 * addresses, invoices and identifiers before it leaves the phone. Native
 * crashes are not reported (they bypass the scrubber).
 */
import * as Sentry from '@sentry/react-native';
import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { CHANNEL } from './features';

// Direct member access: Expo inlines EXPO_PUBLIC_* only in this form.
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

/** Whether this build can send crash reports at all. */
export const CRASH_REPORTING_AVAILABLE = !!DSN;

const REDACTED = '[redacted]';
const BIP39 = new Set(wordlist);
const PATTERNS: RegExp[] = [
  /nostr\+walletconnect:\/\/\S+/gi,
  /\brgb:[^\s"'<>]+/gi,
  // Any bech32/bech32m string (addresses, invoices, Nostr keys, LNURL, offers, Spark/Ark/Liquid).
  /\b[a-z][a-z0-9]{0,30}1[02-9ac-hj-np-z]{20,}\b/gi,
  // Any long base58 string: legacy addresses, WIF and extended keys.
  /\b[1-9A-HJ-NP-Za-km-z]{25,}\b/g,
  /\b[0-9a-f]{32,}\b/gi,
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,
];

/** Words this close together count as one phrase: only spaces, quotes, commas and brackets between them. */
const PHRASE_GAP = /^[\s"'`,;:|()[\]{}-]*$/;
/** A run of this many BIP39 words is treated as (part of) a recovery phrase. */
const PHRASE_MIN_WORDS = 5;

function redactPhrases(text: string): string {
  const parts: string[] = [];
  let cursor = 0;
  let run: { start: number; end: number; words: number } | null = null;
  const close = () => {
    if (run && run.words >= PHRASE_MIN_WORDS) {
      parts.push(text.slice(cursor, run.start), REDACTED);
      cursor = run.end;
    }
    run = null;
  };
  for (const match of text.matchAll(/[A-Za-z]+/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const isWord = BIP39.has(match[0].toLowerCase());
    if (run && isWord && PHRASE_GAP.test(text.slice(run.end, start))) {
      run.end = end;
      run.words += 1;
      continue;
    }
    close();
    if (isWord) run = { start, end, words: 1 };
  }
  close();
  parts.push(text.slice(cursor));
  return parts.join('');
}

/** Replaces recovery phrases (runs of BIP39 words), then every pattern above. */
export function scrub(text: string): string {
  return PATTERNS.reduce((out, pattern) => out.replace(pattern, REDACTED), redactPhrases(text));
}

const KEPT_BREADCRUMBS = new Set(['navigation', 'app.lifecycle', 'device.orientation', 'app.memory']);

export function filterBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (!breadcrumb.category || !KEPT_BREADCRUMBS.has(breadcrumb.category)) return null;
  return { ...breadcrumb, message: breadcrumb.message ? scrub(breadcrumb.message) : undefined, data: undefined };
}

/** Device and runtime facts only; any other context can carry app data. */
const KEPT_CONTEXTS = new Set(['app', 'device', 'os', 'runtime', 'culture']);

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  delete event.request;
  delete event.extra;
  delete event.server_name;
  if (event.contexts) {
    for (const key of Object.keys(event.contexts)) if (!KEPT_CONTEXTS.has(key)) delete event.contexts[key];
  }
  if (event.tags) {
    for (const [key, value] of Object.entries(event.tags)) event.tags[key] = typeof value === 'string' ? scrub(value) : value;
  }
  if (event.message) event.message = scrub(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrub(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) delete frame.vars;
  }
  event.breadcrumbs = event.breadcrumbs
    ?.map(filterBreadcrumb)
    .filter((b): b is Breadcrumb => b !== null);
  return event;
}

let started = false;

/** Starts or stops reporting to match the user's choice. */
export function setCrashReporting(enabled: boolean): void {
  if (!DSN) return;
  if (enabled && !started) {
    Sentry.init({
      dsn: DSN,
      environment: CHANNEL,
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      tracesSampleRate: 0,
      enableAutoPerformanceTracing: false,
      // Native crashes are sent by the native SDK and never pass through
      // beforeSend, so they could carry unscrubbed messages (e.g. a native
      // error naming an address). Off until native-side scrubbing exists.
      enableNativeCrashHandling: false,
      maxBreadcrumbs: 30,
      // Crash-free session rates are the beta exit metric.
      enableAutoSessionTracking: true,
      beforeBreadcrumb: filterBreadcrumb,
      beforeSend: scrubEvent,
    });
    started = true;
  } else if (!enabled && started) {
    void Sentry.close();
    started = false;
  }
}

/** Reports an error the app caught (e.g. a render error), when reporting is on. */
export function reportError(error: unknown, where: string): void {
  if (!started) return;
  Sentry.captureException(error, { tags: { where } });
}
