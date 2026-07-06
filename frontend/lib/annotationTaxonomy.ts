// Annotation taxonomy constants — mirrors the Mira Asset Annotation App exactly.
// Used by Engineer Review Mode for asset typing, damage coding, severity and
// structural segment selection.

export type IndustryCategory = 'coastal' | 'railway' | 'wind';

export const ASSET_TYPES_BY_CATEGORY: Record<IndustryCategory, { value: string; label: string }[]> = {
  coastal: [
    { value: 'pier', label: 'Pier' },
    { value: 'bulkhead', label: 'Bulkhead' },
    { value: 'seawall', label: 'Seawall' },
    { value: 'wharf', label: 'Wharf' },
    { value: 'dock', label: 'Dock' },
    { value: 'bridge', label: 'Bridge' },
    { value: 'retaining_wall', label: 'Retaining Wall' },
    { value: 'other', label: 'Other' },
  ],
  railway: [
    { value: 'track', label: 'Track' },
    { value: 'bridge', label: 'Bridge' },
    { value: 'tunnel', label: 'Tunnel' },
    { value: 'station', label: 'Station' },
    { value: 'signal', label: 'Signal Equipment' },
    { value: 'other', label: 'Other' },
  ],
  wind: [
    { value: 'turbine', label: 'Turbine' },
    { value: 'foundation', label: 'Foundation' },
    { value: 'blade', label: 'Blade' },
    { value: 'nacelle', label: 'Nacelle' },
    { value: 'tower', label: 'Tower' },
    { value: 'other', label: 'Other' },
  ],
};

export const DAMAGE_TYPES_BY_CATEGORY: Record<IndustryCategory, { code: string; label: string }[]> = {
  coastal: [
    { code: 'CR', label: 'Cracking' },
    { code: 'SP', label: 'Spalling' },
    { code: 'CO', label: 'Corrosion' },
    { code: 'LO', label: 'Loss of Section' },
    { code: 'DE', label: 'Decay' },
    { code: 'BG', label: 'Biological Growth' },
    { code: 'CF', label: 'Coating Failure' },
    { code: 'ER', label: 'Erosion' },
    { code: 'SC', label: 'Scour' },
    { code: 'MG', label: 'Marine Growth' },
  ],
  railway: [
    { code: 'CR', label: 'Cracking' },
    { code: 'CO', label: 'Corrosion' },
    { code: 'WR', label: 'Wear' },
    { code: 'DF', label: 'Deformation' },
    { code: 'BK', label: 'Broken Component' },
    { code: 'MS', label: 'Missing Component' },
    { code: 'LO', label: 'Loose Fastener' },
    { code: 'AL', label: 'Alignment Issue' },
  ],
  wind: [
    { code: 'CR', label: 'Cracking' },
    { code: 'ER', label: 'Erosion' },
    { code: 'LT', label: 'Lightning Damage' },
    { code: 'IC', label: 'Ice Damage' },
    { code: 'CO', label: 'Corrosion' },
    { code: 'DL', label: 'Delamination' },
    { code: 'IM', label: 'Impact Damage' },
    { code: 'OL', label: 'Oil Leak' },
  ],
};

export const SEVERITY_LEVELS: { level: 1 | 2 | 3 | 4; sev: 'S1' | 'S2' | 'S3' | 'S4'; label: string; hex: string }[] = [
  { level: 1, sev: 'S1', label: 'Minor', hex: '#10b981' },
  { level: 2, sev: 'S2', label: 'Moderate', hex: '#f59e0b' },
  { level: 3, sev: 'S3', label: 'Advanced', hex: '#f97316' },
  { level: 4, sev: 'S4', label: 'Severe', hex: '#ef4444' },
];

export const STRUCTURAL_SEGMENTS: { code: string; name: string; category: string }[] = [
  { code: 'DT', name: 'Deck – Topside', category: 'Deck' },
  { code: 'DU', name: 'Deck – Underside', category: 'Deck' },
  { code: 'CP', name: 'Pile Caps / Concrete Caps', category: 'Piles' },
  { code: 'PT', name: 'Timber Piles', category: 'Piles' },
  { code: 'PS', name: 'Steel Piles', category: 'Piles' },
  { code: 'SZ', name: 'Splash Zone', category: 'Water Interface' },
  { code: 'FD', name: 'Fender System', category: 'Protection' },
  { code: 'BH', name: 'Bulkhead / Seawall', category: 'Protection' },
  { code: 'SS', name: 'Steel Superstructure / Framing', category: 'Structure' },
  { code: 'AR', name: 'Anchors / Tie Rods', category: 'Structure' },
  { code: 'AP', name: 'Appurtenances & Fixtures', category: 'Other' },
  { code: 'BP', name: 'Barge Pier (barge platform)', category: 'Other' },
];

/** Map an infrastructure type string to its industry category. */
export function industryCategoryOf(infrastructureType?: string | null): IndustryCategory {
  switch (infrastructureType) {
    case 'wind_turbine':
    case 'turbine':
    case 'wind':
      return 'wind';
    case 'railway':
    case 'track':
      return 'railway';
    default:
      // coastal, pier, breakwater, seawall, undefined, etc.
      return 'coastal';
  }
}

/** Human label for a damage code within a category. Falls back to the code itself. */
export function damageLabelOf(code: string, category: IndustryCategory): string {
  return DAMAGE_TYPES_BY_CATEGORY[category].find((d) => d.code === code)?.label ?? code;
}

/**
 * Build an annotation label exactly like the Annotation App:
 * parts = [code, `Sev {n} ({Label})`, segments.join(', ')], omitting
 * anything missing, joined with ' | '.
 */
export function buildAnnotationLabel(args: {
  damageCode?: string | null;
  severity?: 'S1' | 'S2' | 'S3' | 'S4' | null;
  segments?: string[] | null;
}): string {
  const parts: string[] = [];
  if (args.damageCode) parts.push(args.damageCode);
  if (args.severity) {
    const n = parseInt(args.severity.slice(1), 10);
    const entry = SEVERITY_LEVELS.find((s) => s.sev === args.severity);
    parts.push(`Sev ${n}${entry ? ` (${entry.label})` : ''}`);
  }
  if (args.segments && args.segments.length > 0) parts.push(args.segments.join(', '));
  return parts.join(' | ');
}

/**
 * Lowercase full damage-type name for storing in Detection.damage_type,
 * e.g. CO → 'corrosion', LO (coastal) → 'loss of section'.
 */
export function damageTypeNameOf(code: string, category: IndustryCategory): string {
  return damageLabelOf(code, category).toLowerCase();
}

/**
 * Canonical-label lookup built from the existing taxonomy constants.
 * Maps each label.toLowerCase() → canonical label, and each code.toLowerCase()
 * → canonical label as a bonus. Later categories overwrite earlier ones on
 * collision, which is fine since colliding codes/labels share the same label.
 */
const CANONICAL_DAMAGE_LABELS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const list of Object.values(DAMAGE_TYPES_BY_CATEGORY)) {
    for (const { code, label } of list) {
      map[label.toLowerCase()] = label;
      map[code.toLowerCase()] = label;
    }
  }
  return map;
})();

const LOWERCASE_CONNECTORS = new Set(['of', 'and', 'the', 'a', 'an', 'to', 'in', 'on', 'for']);

/**
 * Normalize a raw damage_type string to a canonical, consistently-cased label
 * for DISPLAY only. Never use for values sent to the backend or as keys.
 *
 * - '' / null / undefined → ''
 * - trims + lowercases + looks up in the taxonomy map → canonical label
 * - otherwise smart title-cases, keeping common connector words lowercase
 *   (unless first word); first letter always capitalized.
 */
export function canonicalDamageLabel(raw?: string | null): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const key = trimmed.toLowerCase();
  const canonical = CANONICAL_DAMAGE_LABELS[key];
  if (canonical) return canonical;

  const words = key.split(/\s+/);
  const titled = words
    .map((word, i) => {
      if (i !== 0 && LOWERCASE_CONNECTORS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
  return titled.charAt(0).toUpperCase() + titled.slice(1);
}
