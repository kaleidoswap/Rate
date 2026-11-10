/** Never hand a failed HTTP response or a truncated model to the native loader. */
export function validateModelDownload(status: number | undefined, bytes: number, expectedBytes: number): void {
  if (status !== 200) {
    throw new Error(`Model download failed${status == null ? '' : ` (HTTP ${status})`}. Check your connection and retry.`);
  }
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
    throw new Error('The model download size is unavailable. Choose another model in Models & privacy.');
  }
  if (bytes !== expectedBytes) {
    throw new Error('The model download is incomplete. Check available storage and your connection, then retry.');
  }
}
