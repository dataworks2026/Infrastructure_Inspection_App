/**
 * Per-asset → photogrammetric twin lookup.
 *
 * The standalone /twin/ viewer is keyed by ODM mission_id. Different orgs
 * have different assets and different available twins. This map is the
 * single source of truth for "given this asset, which mission's OBJ should
 * the dashboard / 3D viewer render."
 *
 * Add a new row here whenever a new ULTRA twin completes for an asset.
 */
export interface TwinRef {
  mid: string;
  name: string;
}

type Asset = { id?: string; name?: string; [k: string]: unknown };

// Match by asset_id first (exact), then fall back to a fuzzy asset-name match
// so that orgs that re-created assets under new UUIDs still resolve correctly.
const BY_ASSET_ID: Record<string, TwinRef> = {
  // Brooklyn Army Terminal (brooklynarmyterminal account)
  'a47e466a-1a26-49d7-b250-f47b77edbcbd': {
    mid: '68cf3404-5834-4f0a-9f00-6c62084e8857',
    name: 'BAT Pier 4',
  },
  // Yankee Pier — gov_island account
  '9529698c-3a32-49fe-a288-9e57cc857f76': {
    mid: '2abe1a45-0fc7-4e92-9d87-5c7cc7b0c1b8',
    name: 'Yankee Pier',
  },
  // Yankee Pier — original (handoff doc id, kept for back-compat)
  'f6c73121-b780-499f-aaf9-26a1732876d9': {
    mid: '2abe1a45-0fc7-4e92-9d87-5c7cc7b0c1b8',
    name: 'Yankee Pier',
  },
};

const BY_NAME_HINT: Array<{ match: RegExp; ref: TwinRef }> = [
  { match: /brooklyn|bat\b|army terminal/i,
    ref: { mid: '68cf3404-5834-4f0a-9f00-6c62084e8857', name: 'BAT Pier 4' } },
  { match: /yankee/i,
    ref: { mid: '2abe1a45-0fc7-4e92-9d87-5c7cc7b0c1b8', name: 'Yankee Pier' } },
];

/** Pick the right twin for the logged-in user, given their asset list. */
export function resolveTwinForUser(assets: Asset[]): TwinRef | null {
  if (!assets || assets.length === 0) return null;
  // 1) Exact asset_id hit
  for (const a of assets) {
    if (a?.id && BY_ASSET_ID[a.id]) return BY_ASSET_ID[a.id];
  }
  // 2) Asset name fuzzy hit
  for (const a of assets) {
    const n = String(a?.name ?? '');
    for (const { match, ref } of BY_NAME_HINT) {
      if (match.test(n)) return ref;
    }
  }
  // 3) No mapping — caller decides whether to render a fallback or empty state.
  return null;
}

/** Resolve a twin by a specific asset_id (used on the asset detail page). */
export function resolveTwinByAssetId(assetId: string | null | undefined): TwinRef | null {
  if (!assetId) return null;
  return BY_ASSET_ID[assetId] ?? null;
}
