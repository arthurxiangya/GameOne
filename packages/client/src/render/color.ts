/** sRGB transfer function, matching three.js colour management. */
export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Converts vertex colours from the shared mesher (sRGB) to linear in place, as three.js expects. */
export function linearizeColors(colors: Float32Array): Float32Array {
  for (let i = 0; i < colors.length; i++) colors[i] = srgbToLinear(colors[i]!);
  return colors;
}
