from app.services.reports.damage_codes import (
    CANONICAL_CODES,
    CODE_LABELS,
    map_damage_code,
    map_segment,
    map_severity,
)

_SEVERITY_TO_KEY = {
    "S1": "minor",
    "S2": "moderate",
    "S3": "advanced",
    "S4": "severe",
}


def build_report_data(
    records: list[dict],
    meta: dict,
    narrative: dict,
) -> dict:
    """
    Aggregate enriched detection records into the structured dict consumed
    by generate_pdf().

    Parameters
    ----------
    records   : output of load_input(), filtered to one inspection
    meta      : output of extract_metadata()
    narrative : output of generate_narrative()

    Returns
    -------
    {
        "metadata": dict,
        "summary": {
            "total_detections": int,
            "total_images": int,
            "matrix": list[dict],       # one row per canonical code
            "column_totals": dict,
        },
        "image_findings": list[dict],   # sorted by image_filename
        "narrative": dict,
    }
    """
    # matrix accumulator: code → severity bucket → count
    matrix_counts: dict[str, dict[str, int]] = {
        code: {"minor": 0, "moderate": 0, "advanced": 0, "severe": 0}
        for code in CANONICAL_CODES
    }

    # image grouping 
    image_map: dict[str, dict] = {}

    for rec in records:
        damage_code   = map_damage_code(rec.get("defect_type", ""), rec.get("damage_description"))
        severity_label = map_severity(rec.get("severity", ""))
        segment        = map_segment(rec.get("component_type", ""), rec.get("damage_description"))

        if damage_code in matrix_counts:
            bucket = _SEVERITY_TO_KEY.get(rec.get("severity", ""))
            if bucket:
                matrix_counts[damage_code][bucket] += 1

        image_id = rec.get("image_id", "")
        if image_id not in image_map:
            image_map[image_id] = {
                "image_id":       image_id,
                "image_filename": rec.get("image_filename", image_id),
                "image_path":     rec.get("image_path"),
                "detections":     [],
            }
        image_map[image_id]["detections"].append({
            "damage_code":    damage_code,
            "severity_label": severity_label,
            "segment":        segment,
            "bbox":           rec.get("bbox"),
        })

    # build matrix rows in canonical order 
    matrix = []
    for code in CANONICAL_CODES:
        counts = matrix_counts[code]
        matrix.append({
            "code":     code,
            "label":    CODE_LABELS[code],
            "minor":    counts["minor"],
            "moderate": counts["moderate"],
            "advanced": counts["advanced"],
            "severe":   counts["severe"],
            "total":    sum(counts.values()),
        })

    col_totals = {
        "minor":    sum(r["minor"]    for r in matrix),
        "moderate": sum(r["moderate"] for r in matrix),
        "advanced": sum(r["advanced"] for r in matrix),
        "severe":   sum(r["severe"]   for r in matrix),
        "total":    len(records),
    }

    image_findings = sorted(
        image_map.values(),
        key=lambda x: x["image_filename"],
    )

    return {
        "metadata": meta,
        "summary": {
            "total_detections": len(records),
            "total_images":     meta.get("total_images", 0),
            "matrix":           matrix,
            "column_totals":    col_totals,
        },
        "image_findings": image_findings,
        "narrative":      narrative,
    }
