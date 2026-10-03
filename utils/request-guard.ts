/** Ignore async results once a newer input replaces them or the screen closes. */
export function createRequestGuard() {
  let revision = 0;
  return {
    begin() {
      const current = ++revision;
      return () => revision === current;
    },
    invalidate() { revision++; },
  };
}
