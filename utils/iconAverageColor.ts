// Derives the average color of an asset icon (PNG) so a card gradient can be
// tinted dynamically to the icon rather than a static per-ticker color.
//
// Pure JS (no native module): fetch the PNG → decode with upng-js → average the
// non-transparent pixels. Results are cached per URI. Non-PNG (e.g. DiceBear
// SVG) or fetch failures resolve to null so callers fall back to a brand color.
import { useEffect, useState } from 'react';
// @ts-ignore — upng-js ships no type declarations
import UPNG from 'upng-js';

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

export async function averageIconColor(uri?: string): Promise<string | null> {
  if (!uri) return null;
  if (cache.has(uri)) return cache.get(uri) ?? null;
  const existing = inflight.get(uri);
  if (existing) return existing;

  const job = (async (): Promise<string | null> => {
    try {
      const res = await fetch(uri);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const img: any = UPNG.decode(buf);
      const frame: ArrayBuffer = UPNG.toRGBA8(img)[0];
      const px = new Uint8Array(frame);
      let r = 0, g = 0, b = 0, n = 0;
      // Sample (every Nth pixel) to bound cost on larger icons.
      const px4 = px.length / 4;
      const step = Math.max(1, Math.floor(px4 / 2000)) * 4;
      for (let i = 0; i + 3 < px.length; i += step) {
        if (px[i + 3] < 128) continue; // skip transparent
        r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
      }
      if (!n) return null;
      return (
        '#' +
        [r, g, b]
          .map((c) => Math.round(c / n).toString(16).padStart(2, '0'))
          .join('')
      );
    } catch {
      return null;
    }
  })();

  inflight.set(uri, job);
  const result = await job;
  cache.set(uri, result);
  inflight.delete(uri);
  return result;
}

/** Average icon color for `uri`, falling back to `fallback` until/unless it resolves. */
export function useAverageIconColor(uri: string | undefined, fallback: string): string {
  const [color, setColor] = useState<string>(fallback);
  useEffect(() => {
    let active = true;
    setColor(fallback);
    averageIconColor(uri).then((c) => {
      if (active && c) setColor(c);
    });
    return () => {
      active = false;
    };
  }, [uri, fallback]);
  return color;
}
