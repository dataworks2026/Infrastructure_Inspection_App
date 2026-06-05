import statistics

def calculate_metrics(records):
    if not records:
        raise ValueError("Cannot calculate metrics: records list is empty.")

    total_detections = len(records)

    defect_counts = {}
    severity_counts = {}
    risk_level_counts = {}
    defect_severity_matrix: dict[str, dict[str, int]] = {}
    image_ids_seen: set[str] = set()

    for record in records:
        defect = record["defect_type"]
        defect_counts[defect] = defect_counts.get(defect, 0) + 1

        sev = record["severity"]
        severity_counts[sev] = severity_counts.get(sev, 0) + 1

        rl = record["risk_level"]
        risk_level_counts[rl] = risk_level_counts.get(rl, 0) + 1

        if defect not in defect_severity_matrix:
            defect_severity_matrix[defect] = {}
        defect_severity_matrix[defect][sev] = defect_severity_matrix[defect].get(sev, 0) + 1

        image_id = record.get("image_id", "")
        if image_id:
            image_ids_seen.add(image_id)

    confidences = [record["confidence"] for record in records]
    avg_confidence = statistics.mean(confidences)

    defect_type_percentages = {
        defect: count / total_detections
        for defect, count in defect_counts.items()
    }
    severity_percentages = {
        sev: count / total_detections
        for sev, count in severity_counts.items()
    }

    top_3_defects = sorted(defect_counts.items(), key=lambda x: x[1], reverse=True)[:3]

    high_severity_count = (
        risk_level_counts.get("high", 0) + risk_level_counts.get("critical", 0)
    )
    high_severity_pct = high_severity_count / total_detections

    confidence_distribution = {"low": 0, "medium": 0, "high": 0}
    for c in confidences:
        if c < 0.6:
            confidence_distribution["low"] += 1
        elif c < 0.8:
            confidence_distribution["medium"] += 1
        else:
            confidence_distribution["high"] += 1

    low_confidence_count = confidence_distribution["low"]

    weighted_severity = (
        risk_level_counts.get("critical", 0) * 4
        + risk_level_counts.get("high", 0) * 3
        + risk_level_counts.get("medium", 0) * 1.5
        + risk_level_counts.get("low", 0) * 1
    ) / (total_detections * 4)
    overall_risk_score = round(weighted_severity * 100)

    return {
        "total_detections": total_detections,
        "defect_type_counts": defect_counts,
        "severity_counts": severity_counts,
        "risk_level_counts": risk_level_counts,
        "avg_confidence": avg_confidence,
        "defect_type_percentages": defect_type_percentages,
        "severity_percentages": severity_percentages,
        "top_3_defects": top_3_defects,
        "high_severity_count": high_severity_count,
        "high_severity_pct": high_severity_pct,
        "confidence_distribution": confidence_distribution,
        "low_confidence_count": low_confidence_count,
        "overall_risk_score": overall_risk_score,
        "defect_severity_matrix": defect_severity_matrix,
        "image_count": len(image_ids_seen),
    }
