/** Integer minimum shared by the review and the submitted swap. */
export function minimumSwapOutput(rawOutput: number, slippageBps: number): number {
  if (!Number.isSafeInteger(rawOutput) || rawOutput <= 0 ||
      !Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10000) {
    throw new Error('A valid output quote is required before swapping.');
  }
  return Math.max(1, Number(BigInt(rawOutput) * BigInt(10000 - slippageBps) / 10000n));
}

export function quoteHasExpired(expiry: number, now = Date.now()): boolean {
  return !Number.isFinite(expiry) || expiry <= now;
}
