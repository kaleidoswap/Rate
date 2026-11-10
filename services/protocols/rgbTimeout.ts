/** Bounds waiting in the UI; native operations must retain their own cleanup/locking. */
export async function rgbWithTimeout<T>(operation: Promise<T>, milliseconds: number, message: string, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { onTimeout?.(); reject(new Error(message)); }, milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
