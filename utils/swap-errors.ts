/** What a failed swap screen says: a short title and a sentence the user can act on. */
export interface SwapFailureCopy {
  title: string;
  message: string;
}

/** The maker reported the atomic swap as failed: nothing changed hands. */
export const SWAP_FAILED_COPY: SwapFailureCopy = {
  title: 'Swap failed',
  message: "The provider couldn't complete this swap. Swaps complete in full or not at all, so your funds stay where they were.",
};

/** No final status in time: the swap may still settle. */
export const SWAP_UNCONFIRMED_COPY: SwapFailureCopy = {
  title: 'Not confirmed yet',
  message: "The provider hasn't confirmed this swap yet, so it may still complete. Check Activity and your balance before trying again.",
};

const RULES: Array<[RegExp, SwapFailureCopy]> = [
  [/verification failed|did not match your quote/i, {
    title: 'Swap stopped for your safety',
    message: "The provider's terms didn't match your quote, so nothing was sent. Try again for a new quote.",
  }],
  [/NODE_NOT_CONFIGURED|needs your RGB Lightning node/i, {
    title: 'RGB Lightning node not connected',
    message: 'KaleidoSwap swaps run on your RGB Lightning node. Connect it in Settings, then try again.',
  }],
  [/connection changed/i, {
    title: 'Provider reconnected',
    message: 'The swap provider reconnected after you reviewed the quote. Try again for a new one.',
  }],
  [/QUOTE_EXPIRED|expired|no longer available|(quote|rfq)\S* not found/i, {
    title: 'Quote expired',
    message: 'Prices change quickly and this quote ran out before the swap started. Try again for a fresh quote.',
  }],
  [/liquidity|inventory/i, {
    title: 'Not enough liquidity',
    message: "The provider can't fill this amount right now. Try a smaller amount or try again later.",
  }],
  [/INSUFFICIENT_BALANCE|insufficient (balance|funds)|not enough (balance|funds)/i, {
    title: 'Not enough balance',
    message: "Your account doesn't hold enough for this swap and its fees. Lower the amount and try again.",
  }],
  [/PAIR_NOT_FOUND|pair\b.*\b(not found|unavailable|inactive|not active|disabled|not supported)|unsupported pair|no (trading )?pair/i, {
    title: 'Pair unavailable',
    message: "The provider isn't trading this pair right now. Pick another asset or try again later.",
  }],
  [/below (the )?min|too small|less than (the )?min/i, {
    title: 'Amount too small',
    message: "This amount is below the provider's minimum. Increase it and try again.",
  }],
  [/above (the )?max|too (large|big)|exceeds (the )?max|greater than (the )?max/i, {
    title: 'Amount too large',
    message: "This amount is above the provider's maximum. Lower it and try again.",
  }],
  [/no route|route not found|unable to route|htlc/i, {
    title: "Lightning couldn't carry it",
    message: "Your channels couldn't route this swap. Try a smaller amount, or add channel liquidity.",
  }],
  [/NETWORK_ERROR|TIMEOUT_ERROR|network|timed? ?out|fetch failed|ECONN|unreachable|did not respond/i, {
    title: 'Connection problem',
    message: "Couldn't reach the swap provider. Check your connection and try again.",
  }],
];

const FALLBACK: SwapFailureCopy = {
  title: 'Swap failed',
  message: "The swap didn't go through. Try again, or pick another provider if it keeps failing.",
};

/** Plain-language copy for an error thrown while starting or running a swap. */
export function describeSwapFailure(error: unknown): SwapFailureCopy {
  const e = error as { message?: unknown; code?: unknown; details?: unknown } | null | undefined;
  const message = typeof error === 'string' ? error : typeof e?.message === 'string' ? e.message : '';
  const shortfall = /^Can't swap: ([\s\S]+)$/.exec(message);
  if (shortfall) {
    return { title: 'Not enough channel liquidity', message: shortfall[1].charAt(0).toUpperCase() + shortfall[1].slice(1) };
  }
  const text = [message, e?.code, e?.details].filter(v => typeof v === 'string').join(' ');
  return RULES.find(([pattern]) => pattern.test(text))?.[1] ?? FALLBACK;
}
