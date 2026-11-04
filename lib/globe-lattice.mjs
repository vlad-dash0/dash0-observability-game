// The even sphere lattice behind the globe dots: point `i` of an `n`-point Fibonacci
// lattice as [lat, lon] in degrees, rounded to 2 decimals. Shared by the generator
// (tools/build-globe-data.mjs, which samples land) and hub/globe-data.mjs (which stores
// only lattice indices), so both always agree on where a dot is. Pure.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const round2 = (v) => Math.round(v * 100) / 100;

export function latticePoint(i, n) {
  const lat = (Math.asin(1 - (2 * (i + 0.5)) / n) * 180) / Math.PI;
  let lon = (((i * GOLDEN_ANGLE) % (2 * Math.PI)) * 180) / Math.PI;
  if (lon > 180) lon -= 360;
  return [round2(lat), round2(lon)];
}
