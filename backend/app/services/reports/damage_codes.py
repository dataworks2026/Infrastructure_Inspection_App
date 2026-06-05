DAMAGE_TYPE_TO_CODE: dict[str, str] = {
    # Cracking 
    "crack_structural":  "CR",
    "crack_fatigue":     "CR",
    "crack_settlement":  "CR",
    "weld_crack":        "CR",
    "weld_anomaly":      "CR",
    "joint_failure":     "CR",
    "bearing_failure":   "CR",
    # Spalling 
    "spalling":          "SP",
    "delamination":      "SP",
    "core_exposure":     "SP",
    "rebar_exposure":    "SP",
    "deck_pothole":      "SP",
    # Corrosion 
    "external_corrosion": "CO",
    "pile_corrosion":     "CO",
    "pitting_corrosion":  "CO",
    "bolt_corrosion":     "CO",
    "anode_depletion":    "CO",
    # Loss 
    "section_loss":       "LO",
    "armor_displacement": "LO",
    "dent_impact":        "LO",
    "dent_mechanical":    "LO",
    "free_span":          "LO",
    # Decay / environmental degradation
    "erosion":            "DE",
    "scour":              "DE",
    "toe_scour":          "DE",
    "crest_settlement":   "DE",
    "wave_overtopping":   "DE",
    # Biological growth
    "marine_growth":      "BG",
    # Coating failure
    "coating_disbond":    "CF",
    "paint_failure":      "CF",
    # RS is description-keyword-only — no damage_type maps here directly
}

_COMPONENT_TO_SEGMENT: dict[str, str] = {
    "deck":   "DT",
    "cap":    "CP",
    "fender": "FD",
    "face":   "BH",
    "joint":  "AP",
}

_ACCESSORY_KEYWORDS = frozenset({"bolt", "bracket", "plate", "ladder", "railing"})

# severity → display label
_SEVERITY_LABELS: dict[str, str] = {
    "S1": "1 - Minor",
    "S2": "2 - Moderate",
    "S3": "3 - Advanced",
    "S4": "4 - Severe",
}

# damage-code display labels (used by report_builder and pdf_report)
CODE_LABELS: dict[str, str] = {
    "CR": "Cracking",
    "SP": "Spalling",
    "CO": "Corrosion",
    "LO": "Loss",
    "DE": "Decay",
    "BG": "Biological Growth",
    "CF": "Coating Failure",
    "RS": "Rust Staining",
}

CANONICAL_CODES: list[str] = ["CR", "SP", "CO", "LO", "DE", "BG", "CF", "RS"]

# Reverse lookup for human-readable category labels.
# Mira's production data stores damage_type as "Corrosion", "Biological Growth",
# etc. — the same strings as CODE_LABELS values — rather than Andrew's
# original snake_case keys ("external_corrosion", "marine_growth", …).
_LABEL_TO_CODE: dict[str, str] = {v.lower(): k for k, v in CODE_LABELS.items()}

def map_damage_code(
    damage_type: str,
    damage_description: str | None = None,
) -> str:
    """
    Return the 2-letter report code for a raw damage_type string.

    Falls back to 'RS' when damage_description contains "rust stain".
    Falls back to 'Unknown' when no mapping exists.
    Never raises.
    """
    key = (damage_type or "").lower()
    code = DAMAGE_TYPE_TO_CODE.get(key) or _LABEL_TO_CODE.get(key)
    if code:
        return code
    if "rust stain" in (damage_description or "").lower():
        return "RS"
    return "Unknown"


def map_pile_segment(description: str | None) -> str:
    """
    Resolve a pile component_type to its sub-segment code using description
    keywords.

    Returns SZ (splash zone) for tidal/waterline language,
    PT (timber piles) for timber/wood language,
    PS (steel piles) otherwise.
    """
    text = (description or "").lower()
    if any(k in text for k in ("splash", "waterline", "tidal")):
        return "SZ"
    if any(k in text for k in ("timber", "wood")):
        return "PT"
    return "PS"


def map_segment(
    component_type: str,
    description: str | None = None,
) -> str:
    """
    Return the structural segment code for a component_type.

    Resolution order:
    1. Direct lookup in _COMPONENT_TO_SEGMENT
    2. 'pile' → delegate to map_pile_segment()
    3. Keyword fallback on description
    4. 'UNK' — never silently maps to AP

    AP is only returned when component_type is 'joint' (explicit) or
    description contains an accessory keyword (bolt, bracket, plate,
    ladder, railing).
    """
    ct = (component_type or "").lower().strip()
    text = (description or "").lower()

    '''
    Description overriding:
    The description tells us where the damage actually is, which is often
    more specific than the image-level component_type tag. For example,
    the component_type may be 'pile' but the description may say 'pile cap' 
    '''

    # Deck underside / soffit
    if "underside" in text or "soffit" in text:
        return "DU"

    # Pile cap / cap block
    if "pile cap" in text or "cap block" in text:
        return "CP"

    # Pile base / piles — damage is on the pile itself
    if "pile base" in text or "around pile" in text:
        return map_pile_segment(text)
    if "on timber" in text or "on steel" in text or "timber/steel piles" in text:
        return map_pile_segment(text)

    # Deck surface
    if "deck surface" in text or "topside" in text:
        return "DT"

    # Armor stone → bulkhead/seawall
    if "armor" in text:
        return "BH"

    # Joint / sealant failure → appurtenances
    if "joint sealant" in text or "joint failure" in text:
        return "AP"

    # Splash zone
    if "splash" in text or "waterline" in text or "tidal" in text:
        return "SZ"

    # Anchor / tie rod
    if "anchor" in text or "tie rod" in text:
        return "AR"

    # Bulkhead / seawall
    if "bulkhead" in text or "seawall" in text:
        return "BH"

    # ---- Static component_type lookup (fallback) ----
    if ct in _COMPONENT_TO_SEGMENT:
        return _COMPONENT_TO_SEGMENT[ct]

    if ct == "pile":
        return map_pile_segment(description)

    # Accessory keywords
    if any(k in text for k in _ACCESSORY_KEYWORDS):
        return "AP"

    return "UNK"


def map_severity(severity: str) -> str:
    """
    Return the display label for a severity code.

    S1 → '1 - Minor', S2 → '2 - Moderate',
    S3 → '3 - Advanced', S4 → '4 - Severe'.
    Unknown input returns 'Unknown'.
    """
    return _SEVERITY_LABELS.get(severity, "Unknown")
