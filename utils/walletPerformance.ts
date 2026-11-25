type StartupStage = 'pin-visible' | 'dashboard-visible' | 'first-live-balance';
type RuntimePerformance = Performance & { rnStartupTiming?: { startTime?: number } };

let startupAt: number | undefined;
let unlockedAt: number | undefined;
let dashboardAt: number | undefined;
const startupStages = new Set<StartupStage>();

function record(name: string, start: number, end: number) {
  try {
    const perf = globalThis.performance;
    perf?.clearMeasures?.(name);
    perf?.measure?.(name, { start, end });
  } catch {
    // Timing support differs across runtimes. Diagnostics never gate the app.
  }
}

export function startWalletStartup() {
  if (startupAt !== undefined) return;
  const perf = globalThis.performance as RuntimePerformance | undefined;
  const now = perf?.now?.();
  if (now === undefined) return;
  const nativeStart = perf?.rnStartupTiming?.startTime;
  startupAt = nativeStart !== undefined && nativeStart >= 0 && nativeStart <= now ? nativeStart : now;
}

function recordDashboardVisible() {
  if (dashboardAt === undefined || unlockedAt === undefined || startupAt === undefined || startupStages.has('dashboard-visible')) return;
  startupStages.add('dashboard-visible');
  const visibleAt = Math.max(dashboardAt, unlockedAt);
  record('rate.startup.dashboard-visible', startupAt, visibleAt);
  record('rate.startup.unlock-to-dashboard', unlockedAt, visibleAt);
}

export function markWalletUnlocked() {
  unlockedAt ??= globalThis.performance?.now?.();
  recordDashboardVisible();
}

export function markWalletStartup(stage: StartupStage) {
  const now = globalThis.performance?.now?.();
  if (startupAt === undefined || now === undefined || startupStages.has(stage)) return;
  if (stage === 'dashboard-visible') {
    dashboardAt ??= now;
    recordDashboardVisible();
    return;
  }
  startupStages.add(stage);
  record(`rate.startup.${stage}`, startupAt, now);
}

export function startWalletPerformance(name: 'swap-quote'): () => void {
  const start = globalThis.performance?.now?.();
  let done = false;
  return () => {
    const end = globalThis.performance?.now?.();
    if (done || start === undefined || end === undefined) return;
    done = true;
    record(`rate.${name}`, start, end);
  };
}
