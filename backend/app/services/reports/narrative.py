def _risk_label(score: int) -> str:
    if score >= 75:
        return "critical"
    if score >= 50:
        return "high"
    if score >= 30:
        return "medium"
    return "low"


def _fmt(name: str) -> str:
    """Format a snake_case defect name for readable narrative text."""
    return name.replace("_", " ")


def _build_recommendations(metrics: dict, risk_label: str, mode: str) -> list[dict]:
    top_defect = metrics["top_3_defects"][0][0]
    total = metrics["total_detections"]
    top_count = metrics["defect_type_counts"][top_defect]
    top_pct = metrics["defect_type_percentages"][top_defect]
    high_count = metrics["high_severity_count"]
    high_pct = metrics["high_severity_pct"]
    risk_score = metrics["overall_risk_score"]
    matrix = metrics.get("defect_severity_matrix", {})
    image_count = metrics.get("image_count", 0)

    top_sev = matrix.get(top_defect, {})
    top_s3_s4 = top_sev.get("S3", 0) + top_sev.get("S4", 0)
    name = _fmt(top_defect)

    sev_detail = (
        f" {top_s3_s4} of these are at advanced (S3) or severe (S4) severity, "
        f"indicating active structural degradation."
        if top_s3_s4 > 0 else ""
    )

    if risk_label == "critical":
        base = [
            {
                "action": "Halt operations and conduct an emergency structural review.",
                "rationale": (
                    f"Risk score of {risk_score}/100 with {high_count} high/critical "
                    f"detections ({high_pct * 100:.0f}% of total) indicates systemic "
                    f"structural compromise."
                ),
            },
            {
                "action": f"Engage a specialist to assess {name} detections immediately.",
                "rationale": (
                    f"{name.capitalize()} accounts for {top_count} of {total} detections "
                    f"({top_pct * 100:.1f}%).{sev_detail}"
                ),
            },
            {
                "action": "Document all high-severity findings and notify the relevant authority.",
                "rationale": (
                    f"{high_count} detections are classified high or critical. "
                    f"Current high-severity rate of {high_pct * 100:.0f}% may trigger "
                    f"regulatory notification requirements."
                ),
            },
        ]
    elif risk_label == "high":
        base = [
            {
                "action": (
                    f"Schedule urgent follow-up inspection within 48 hours, "
                    f"focusing on {name} areas."
                ),
                "rationale": (
                    f"{name.capitalize()} is the leading defect type with {top_count} of "
                    f"{total} detections ({top_pct * 100:.1f}%).{sev_detail}"
                ),
            },
            {
                "action": "Prioritise remediation of all high-severity detections before next operational cycle.",
                "rationale": (
                    f"{high_count} detections ({high_pct * 100:.0f}%) are classified "
                    f"as high or critical risk. Overall risk score: {risk_score}/100."
                ),
            },
        ]
    elif risk_label == "medium":
        base = [
            {
                "action": f"Plan maintenance for {name} areas within the next scheduled cycle.",
                "rationale": (
                    f"{name.capitalize()} accounts for {top_count} detections "
                    f"({top_pct * 100:.1f}% of total). Risk score of {risk_score}/100 "
                    f"does not require immediate action but warrants scheduled attention."
                ),
            },
            {
                "action": "Monitor affected zones and re-inspect if conditions change.",
                "rationale": (
                    f"{total} defects identified"
                    + (f" across {image_count} inspected images" if image_count else "")
                    + ". Track deterioration trends to prevent escalation to high risk."
                ),
            },
        ]
    else:
        base = [
            {
                "action": "Log findings for the routine maintenance record.",
                "rationale": (
                    f"Risk score of {risk_score}/100 is within acceptable limits. "
                    f"{total} defects identified, predominantly minor severity."
                ),
            },
            {
                "action": "Re-inspect in the next scheduled cycle.",
                "rationale": "No immediate remediation required. Standard inspection interval is sufficient.",
            },
        ]

    if mode == "field":
        low_conf = metrics.get("low_confidence_count", 0)
        base.append({
            "action": "Cross-reference low-confidence detections with visual re-inspection before closing.",
            "rationale": (
                f"{low_conf} detection{'s' if low_conf != 1 else ''} recorded below "
                f"0.6 confidence — verify manually to rule out false positives."
                if low_conf > 0
                else "Visual verification ensures detection accuracy is maintained."
            ),
        })

    return base


def generate_narrative(metrics: dict, mode: str = "executive") -> dict:
    """
    Returns a structured narrative dict.

    Parameters
    ----------
    metrics : dict
        Output of calculate_metrics().
    mode : str
        "executive" (default) — high-level, no confidence scores.
        "field" — includes defect-by-defect breakdown and confidence notes.
    """
    total = metrics["total_detections"]
    top_3 = metrics["top_3_defects"]          # list of (defect, count) tuples
    top_defect, _ = top_3[0]
    top_defect_pct = metrics["defect_type_percentages"][top_defect]

    risk_score = metrics["overall_risk_score"]
    risk_label = _risk_label(risk_score)
    avg_conf = metrics["avg_confidence"]
    high_count = metrics["high_severity_count"]
    high_pct = metrics["high_severity_pct"]

    # --- Executive summary ---
    if risk_label == "critical":
        opening = "This inspection reveals critical conditions requiring immediate action."
    elif risk_label == "high":
        opening = "This inspection reveals significant defects that warrant urgent attention."
    elif risk_label == "medium":
        opening = "This inspection reveals moderate degradation suitable for scheduled maintenance."
    else:
        opening = "This inspection reveals minor issues with low immediate risk."

    high_clause = (
        f" {high_count} detection{'s' if high_count != 1 else ''} ({high_pct * 100:.0f}%) were"
        f" classified as high severity."
        if high_count > 0
        else ""
    )

    executive_summary = (
        f"{opening} A total of {total} defect{'s' if total != 1 else ''} were identified,"
        f" with {top_defect} as the leading type at {top_defect_pct * 100:.1f}% of detections.{high_clause}"
    )

    # --- Technical findings ---
    if mode == "field":
        lines = []
        for defect, count in top_3:
            pct = metrics["defect_type_percentages"][defect]
            lines.append(f"{defect}: {count} detection{'s' if count != 1 else ''} ({pct * 100:.1f}%)")
        if len(metrics["defect_type_counts"]) > 3:
            lines.append("(additional defect types present — see full breakdown)")
        dist = metrics["confidence_distribution"]
        conf_line = (
            f"Model confidence — high: {dist['high']}, medium: {dist['medium']}, low: {dist['low']}."
            f" Average: {avg_conf:.2f}."
        )
        technical_findings = "; ".join(lines) + ". " + conf_line
    else:
        top_labels = ", ".join(
            f"{d} ({metrics['defect_type_percentages'][d] * 100:.1f}%)"
            for d, _ in top_3
        )
        technical_findings = (
            f"Leading defect types: {top_labels}. "
            f"Average detection confidence: {avg_conf:.2f}."
        )

    # --- Confidence note ---
    low_conf_count = metrics["low_confidence_count"]
    if low_conf_count > 0:
        confidence_note = (
            f"{low_conf_count} detection{'s' if low_conf_count != 1 else ''} recorded below"
            f" 0.6 confidence — treat these findings as provisional."
        )
    elif avg_conf < 0.7:
        confidence_note = (
            f"Average confidence of {avg_conf:.2f} is below the recommended 0.70 threshold."
            f" Results should be verified with manual review."
        )
    else:
        confidence_note = None

    recommendations = _build_recommendations(metrics, risk_label, mode)

    return {
        "executive_summary": executive_summary,
        "technical_findings": technical_findings,
        "risk_assessment": risk_label,
        "risk_score": risk_score,
        "recommendations": recommendations,
        "confidence_note": confidence_note,
    }
