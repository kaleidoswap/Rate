export type ReceiveProtocol = 'RGB' | 'SPARK' | 'ARKADE' | 'LIQUID';
export type ReceiveMethodKind = 'address' | 'invoice';
export type ReceiveMonitorKind = 'balance' | 'invoice' | 'spark-claim' | 'none';
export type ReceiveLayer = 'onchain' | 'lightning' | 'rgb' | 'spark' | 'arkade' | 'liquid';

export interface ReceiveMethod {
  key: string;
  label: string;
  value: string;
  protocol: ReceiveProtocol;
  kind: ReceiveMethodKind;
  layer: ReceiveLayer;
  monitor: ReceiveMonitorKind;
  assetId?: string;
}

export class ReceiveOperationTimeoutError extends Error {
  constructor(
    public readonly operation: string,
    public readonly timeoutMs: number,
  ) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = 'ReceiveOperationTimeoutError';
  }
}

export async function runReceiveOperation<T>(
  operation: string,
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 8_000,
  parentSignal?: AbortSignal,
): Promise<T> {
  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const abortFromParent = () => controller.abort(parentSignal?.reason);

  try {
    if (parentSignal?.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    }
    if (controller.signal.aborted) {
      throw controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new Error(`${operation} was cancelled`);
    }
    return await Promise.race([
      task(controller.signal),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort(new ReceiveOperationTimeoutError(operation, timeoutMs));
          reject(new ReceiveOperationTimeoutError(operation, timeoutMs));
        }, timeoutMs);
      }),
      new Promise<T>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(
            controller.signal.reason instanceof Error
              ? controller.signal.reason
              : new Error(`${operation} was cancelled`),
          );
        }, { once: true });
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    parentSignal?.removeEventListener('abort', abortFromParent);
    const durationMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt;
    if (__DEV__ && durationMs >= 500) {
      console.warn(`[ReceivePerformance] ${operation} took ${Math.round(durationMs)}ms`);
    }
  }
}

export function upsertReceiveMethod(
  methods: ReceiveMethod[],
  method: ReceiveMethod,
): ReceiveMethod[] {
  const index = methods.findIndex((candidate) => candidate.key === method.key);
  if (index < 0) return [...methods, method];
  const next = [...methods];
  next[index] = method;
  return next;
}

export function receiveMethodsSignature(methods: ReceiveMethod[]): string {
  return methods
    .map((method) => [
      method.key,
      method.protocol,
      method.kind,
      method.monitor,
      method.assetId ?? '',
      method.value,
    ].join(':'))
    .sort()
    .join('|');
}

export function callAbortableAdapterMethod<T>(
  adapter: any,
  method: string,
  args: unknown[],
  signal: AbortSignal,
): Promise<T> {
  const abortable = adapter?.[`${method}WithSignal`];
  if (typeof abortable === 'function') {
    return abortable.apply(adapter, [...args, signal]) as Promise<T>;
  }
  const fallback = adapter?.[method];
  if (typeof fallback !== 'function') {
    return Promise.reject(new Error(`Adapter method '${method}' is unavailable`));
  }
  return fallback.apply(adapter, args) as Promise<T>;
}
