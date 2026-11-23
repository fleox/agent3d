// Browser e2e timeouts follow AGENT3D_CDP_TIMEOUT_MS: CI sets it above the
// 60 s default because shared runners render WebGL in software (SwiftShader),
// and every wait of a test has to stretch by the same factor.
const DEFAULT_CDP_TIMEOUT_MS = 60_000;

export const E2E_SLOWDOWN = Math.max(1, (Number(process.env.AGENT3D_CDP_TIMEOUT_MS) || DEFAULT_CDP_TIMEOUT_MS) / DEFAULT_CDP_TIMEOUT_MS);

/** A test or wait timeout, stretched on slow machines. */
export function e2eTimeout(ms: number): number {
  return Math.round(ms * E2E_SLOWDOWN);
}
