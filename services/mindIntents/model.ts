// On-device text completion for the intent bar and Explain. No tools, no
// network: the local QVAC model when it is loaded, otherwise nothing (callers
// fall back to rules and templates).

import type QVACService from '../QVACService';

export interface LocalTextModel {
  /** The model is loaded and can answer now. */
  ready(): boolean;
  complete(system: string, user: string, opts?: { maxTokens?: number; timeoutMs?: number }): Promise<string>;
}

const DEFAULT_TIMEOUT_MS = 12_000;

/** The app's on-device model, or one that is never ready while KaleidoMind is off. */
export function localTextModel(given?: QVACService): LocalTextModel {
  // Loaded on first use so screens that only show the bar don't start the QVAC SDK.
  const qvac: QVACService = given ?? require('../QVACService').default.getInstance();
  return {
    ready: () => qvac.isEnabled() && qvac.getState().llmStatus === 'ready',
    async complete(system, user, opts = {}) {
      let requestId: string | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const turn = qvac.runProviderTurn({
        system,
        messages: [{ role: 'user', content: user }],
        tools: [],
        toolChoice: 'none',
        thinking: 'off',
        temperature: 0,
        maxTokens: opts.maxTokens ?? 200,
      }).then((out) => { requestId = out.requestId; return out.text ?? ''; });
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          if (requestId) void qvac.cancelRequest(requestId).catch(() => {});
          reject(new Error('The on-device model took too long.'));
        }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      });
      try {
        return await Promise.race([turn, timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
