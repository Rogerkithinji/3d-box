// Sunlight for the form study: one directional light, and a posterised
// value ramp that turns the light angle into discrete tones.

/** Unit vector pointing from the form toward the light. */
export function lightDirection(azDeg: number, elDeg: number): [number, number, number] {
  const az = azDeg * Math.PI / 180
  const el = elDeg * Math.PI / 180
  return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)]
}

export const LIGHT_MAX_STEPS = 4

// Perceptual values (0 = black, 1 = white) for each band. Shadow bands run
// from the terminator outward (core shadow first, reflected light last);
// light bands run from the terminator toward the light (halftone first,
// highlight last). The two sides never overlap, so the terminator always
// reads as a jump.
const SHADOW_TOP = 0.32
const LIGHT_BOTTOM = 0.58

export function valueBands(lightSteps: number, shadowSteps: number): { shadow: number[]; light: number[] } {
  const M = Math.max(1, Math.min(LIGHT_MAX_STEPS, Math.round(shadowSteps)))
  const N = Math.max(1, Math.min(LIGHT_MAX_STEPS, Math.round(lightSteps)))
  const shadow = Array.from({ length: M }, (_, k) => M === 1 ? 0 : SHADOW_TOP * k / (M - 1))
  const light  = Array.from({ length: N }, (_, j) => N === 1 ? 1 : 1 - (1 - LIGHT_BOTTOM) * (N - 1 - j) / (N - 1))
  return { shadow, light }
}

/** Value for a Lambert term n·L in [-1, 1] under the given band counts. */
export function valueAt(dot: number, lightSteps: number, shadowSteps: number): number {
  const { shadow, light } = valueBands(lightSteps, shadowSteps)
  if (dot < 0) {
    const k = Math.min(shadow.length - 1, Math.floor(-dot * shadow.length))
    return shadow[k]
  }
  const j = Math.min(light.length - 1, Math.floor(dot * light.length))
  return light[j]
}

export const SHADOW_BAND_NAMES = ["core shadow", "reflected light", "reflected", "reflected"]
export const LIGHT_BAND_NAMES  = ["halftone", "light", "highlight", "highlight"]
