/**
 * Crash reporting (Sentry), opt-in.
 *
 * Off until the user turns on "Send crash reports" in Settings, and only in
 * builds that carry a DSN (EXPO_PUBLIC_SENTRY_DSN). Reports never carry wallet
 * data: no user, no request bodies, no console or network breadcrumbs, and every
 * string is scrubbed of keys, seeds, addresses, invoices and identifiers before
 * it leaves the phone.
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
  /\bln(?:bc|tb|bcrt|tbs)[0-9a-z]{20,}/gi,
  /\b(?:bc1|tb1|bcrt1|sp1|sprt1|spark1|ark1|tark1|npub1|nsec1|nprofile1|nevent1|naddr1|lnurl1|lno1|lni1|btkn1|lq1|ex1|tlq1|el1)[0-9a-z]{8,}/gi,
  /\b[xtyzuv](?:prv|pub)[1-9A-HJ-NP-Za-km-z]{100,}/g,
  /\b[123mnQ][1-9A-HJ-NP-Za-km-z]{25,60}\b/g,
  /\b[0-9a-f]{32,}\b/gi,
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,
];

/** Replaces any run of 12 or more BIP39 words, then every pattern above. */
export function scrub(text: string): string {
  const tokens = text.split(/(\s+)/);
  let runStart = -1;
  let runEnd = -1;
  let runWords = 0;
  const redactRun = () => {
    if (runWords >= 12) tokens.splice(runStart, runEnd - runStart, REDACTED, ...Array(runEnd - runStart - 1).fill(''));
    runStart = -1; runWords = 0;
  };
  tokens.forEach((token, i) => {
    if (/^\s+$/.test(token)) return;
    if (BIP39.has(token.toLowerCase())) {
      if (runStart < 0) runStart = i;
      runEnd = i + 1;
      runWords += 1;
    } else redactRun();
  });
  redactRun();
  return PATTERNS.reduce((out, pattern) => out.replace(pattern, REDACTED), tokens.join(''));
}

const KEPT_BREADCRUMBS = new Set(['navigation', 'app.lifecycle', 'device.orientation', 'app.memory']);

export function filterBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (!breadcrumb.category || !KEPT_BREADCRUMBS.has(breadcrumb.category)) return null;
  return { ...breadcrumb, message: breadcrumb.message ? scrub(breadcrumb.message) : undefined, data: undefined };
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  delete event.request;
  delete event.extra;
  delete event.server_name;
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
