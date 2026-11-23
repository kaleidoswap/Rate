/**
 * Crash reporting (Sentry), opt-in.
 *
 * Off until the user turns on "Send crash reports" in Settings, and only in
 * builds that carry a DSN (EXPO_PUBLIC_SENTRY_DSN). JS reports contain fixed
 * error labels, bundle locations and a few build and OS fields. Native crash
 * reporting is disabled because its events bypass the JS allowlist.
 */
import * as Sentry from '@sentry/react-native';
import type { Breadcrumb, ErrorEvent, StackFrame } from '@sentry/react-native';
import { CHANNEL } from './features';

// Direct member access: Expo inlines EXPO_PUBLIC_* only in this form.
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

/** Whether this build can send crash reports at all. */
export const CRASH_REPORTING_AVAILABLE = !!DSN;

const BUNDLE_FILES = new Set(['app:///index.android.bundle', 'app:///main.jsbundle']);
const JS_ERROR_TYPES = new Set([
  'Error', 'AggregateError', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError',
]);
const KEPT_BREADCRUMBS = new Set(['navigation', 'app.lifecycle', 'device.orientation', 'app.memory']);
const OS_NAMES = new Set(['Android', 'iOS']);
const RELEASE = /^com\.kaleidoswap\.wallet@\d{1,4}\.\d{1,4}\.\d{1,4}\+\d{1,12}$/;
const BUILD = /^\d{1,12}$/;
const OS_VERSION = /^\d{1,3}(?:\.\d{1,3}){0,3}$/;
const EVENT_ID = /^[0-9a-f]{32}$/;
const DEBUG_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function filterBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  const { category, timestamp } = breadcrumb;
  if (!category || !KEPT_BREADCRUMBS.has(category)) return null;
  return { category, timestamp: Number.isFinite(timestamp) ? timestamp : undefined };
}

function bundleFrame({ filename, lineno, colno }: StackFrame): StackFrame | null {
  if (!filename || !BUNDLE_FILES.has(filename) ||
      typeof lineno !== 'number' || !Number.isSafeInteger(lineno) || lineno < 1) return null;
  return {
    filename,
    lineno,
    colno: typeof colno === 'number' && Number.isSafeInteger(colno) && colno >= 0 ? colno : undefined,
  };
}

/** Rebuild the event from a fixed schema. Error prose can contain payment amounts or names. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const values = event.exception?.values?.map(exception => {
    const frames = exception.stacktrace?.frames?.map(bundleFrame).filter((frame): frame is StackFrame => frame !== null);
    return {
      type: exception.type && JS_ERROR_TYPES.has(exception.type) ? exception.type : 'Error',
      value: 'JavaScript exception',
      stacktrace: frames?.length ? { frames } : undefined,
      mechanism: typeof exception.mechanism?.handled === 'boolean'
        ? { type: 'generic', handled: exception.mechanism.handled }
        : undefined,
    };
  });
  const images = event.debug_meta?.images?.flatMap(image =>
    image.type === 'sourcemap' && BUNDLE_FILES.has(image.code_file) && DEBUG_ID.test(image.debug_id)
      ? [{ type: image.type, code_file: image.code_file, debug_id: image.debug_id }]
      : [],
  );
  const os = event.contexts?.os;
  return {
    type: undefined,
    event_id: EVENT_ID.test(event.event_id ?? '') ? event.event_id : undefined,
    timestamp: Number.isFinite(event.timestamp) ? event.timestamp : undefined,
    platform: 'javascript',
    level: 'error',
    environment: CHANNEL,
    release: RELEASE.test(event.release ?? '') ? event.release : undefined,
    dist: BUILD.test(event.dist ?? '') ? event.dist : undefined,
    message: values?.length ? undefined : 'JavaScript exception',
    exception: values?.length ? { values } : undefined,
    debug_meta: images?.length ? { images } : undefined,
    tags: event.tags?.where === 'error-boundary' ? { where: 'error-boundary' } : undefined,
    contexts: os?.name && OS_NAMES.has(os.name) ? {
      os: { name: os.name, version: OS_VERSION.test(os.version ?? '') ? os.version : undefined },
    } : undefined,
    breadcrumbs: event.breadcrumbs?.map(filterBreadcrumb).filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null),
  };
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
      // Native errors bypass beforeSend, including iOS watchdog and hang reports.
      enableNativeCrashHandling: false,
      enableWatchdogTerminationTracking: false,
      enableAppHangTracking: false,
      maxBreadcrumbs: 30,
      // Crash-free session rates are the beta exit metric.
      enableAutoSessionTracking: true,
      beforeBreadcrumb: filterBreadcrumb,
      beforeSend: (event, hint) => {
        if (!started) return null;
        hint.attachments = [];
        return scrubEvent(event);
      },
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
