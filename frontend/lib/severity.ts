// ─── Canonical severity palette ──────────────────────────────────────────────
// Single source of truth for severity colors/labels across the app. The detail
// page (severityConfig), ReviewOverlay (SEVERITY_HEX) and ReviewPanel
// (REVIEW_SEVERITY_HEX) all use these exact hex values.

export type Severity = 'S1' | 'S2' | 'S3' | 'S4';

export const SEVERITY_HEX: Record<Severity, string> = {
  S1: '#4CAF50', // green  — Minor
  S2: '#E6A817', // amber  — Moderate
  S3: '#FF7043', // orange — Advanced
  S4: '#B71C1C', // red    — Severe
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  S1: 'Minor',
  S2: 'Moderate',
  S3: 'Advanced',
  S4: 'Severe',
};

/** Neutral slate used when a severity is unknown / unset. */
export const NEUTRAL_HEX = '#64748b';

/**
 * Normalize a loosely-typed severity value to S1..S4.
 * Handles 'S0'/'0' (legacy → S1), bare '1'..'4', and lowercase 's3'.
 * Returns '' when the value can't be mapped.
 */
export function normSeverity(v?: string | null): Severity | '' {
  if (!v) return '';
  const s = String(v).trim().toUpperCase();
  if (s === 'S0' || s === '0') return 'S1';
  const map: Record<string, Severity> = {
    '1': 'S1', '2': 'S2', '3': 'S3', '4': 'S4',
    S1: 'S1', S2: 'S2', S3: 'S3', S4: 'S4',
  };
  return map[s] ?? '';
}

/** Returns the canonical hex for a severity, or the neutral slate when unknown. */
export function severityHex(v?: string | null): string {
  const ns = normSeverity(v);
  return ns ? SEVERITY_HEX[ns] : NEUTRAL_HEX;
}
