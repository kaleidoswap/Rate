// Both remote RGB transports present consent on the same phone. Keep the
// browser review and its subsequent native passkey sheet in the same slot.
let presenting = false;

export async function withRgbApproval<T>(review: () => Promise<T>, busy: () => T): Promise<T> {
  if (presenting) return busy();
  presenting = true;
  try {
    return await review();
  } finally {
    presenting = false;
  }
}
