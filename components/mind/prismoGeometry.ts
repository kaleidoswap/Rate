// Prismo's body: a soft, slightly wide pointy-top hexagon in a 100×100 box,
// split into six facets meeting at a focal point up and left of centre.

type Pt = [number, number];

const CX = 50;
const CY = 50;
const R = 44;
const STRETCH_X = 1.06;
const CORNER = 0.24;
const FOCAL: Pt = [47, 43];

const fmt = (n: number) => Math.round(n * 100) / 100;
const pt = ([x, y]: Pt) => `${fmt(x)} ${fmt(y)}`;
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export const PRISMO_VERTICES: Pt[] = Array.from({ length: 6 }, (_, k) => {
  const a = ((-90 + 60 * k) * Math.PI) / 180;
  return [CX + Math.cos(a) * R * STRETCH_X, CY + Math.sin(a) * R];
});

function roundedPolygon(vs: Pt[], t: number): string {
  const n = vs.length;
  let d = '';
  vs.forEach((v, i) => {
    const a = lerp(v, vs[(i - 1 + n) % n], t);
    const b = lerp(v, vs[(i + 1) % n], t);
    d += `${i === 0 ? 'M' : 'L'}${pt(a)} Q${pt(v)} ${pt(b)} `;
  });
  return `${d}Z`;
}

export const PRISMO_BODY_PATH = roundedPolygon(PRISMO_VERTICES, CORNER);

/** Facet k spans vertex k → k+1 (0 = upper-right, clockwise, 5 = upper-left). */
export const PRISMO_FACET_PATHS: string[] = PRISMO_VERTICES.map(
  (v, k) => `M${pt(FOCAL)} L${pt(v)} L${pt(PRISMO_VERTICES[(k + 1) % 6])} Z`,
);

/** White-overlay opacity per facet: lit from the top-left (the 135° light). */
export const FACET_LIGHT_A = [0.24, 0.08, 0.0, 0.05, 0.16, 0.34];
/** The same light rotated two facets on, cross-faded in for the shimmer. */
export const FACET_LIGHT_B = [0.05, 0.3, 0.2, 0.08, 0.0, 0.14];

export const FACE = {
  eyeY: 54,
  eyeLeftX: 38,
  eyeRightX: 62,
  mouthY: 69,
};

export const FACE_PATHS = {
  closedLeft: 'M32.5 54 Q38 59 43.5 54',
  closedRight: 'M56.5 54 Q62 59 67.5 54',
  happyLeft: 'M32.5 57 L38 50.5 L43.5 57',
  happyRight: 'M56.5 57 L62 50.5 L67.5 57',
  smile: 'M45.5 67.5 Q50 71.5 54.5 67.5',
  grin: 'M43.5 66.5 Q50 74.5 56.5 66.5',
  flat: 'M46 69.5 L54 69.5',
  frown: 'M45.5 71 Q50 67.5 54.5 71',
};
