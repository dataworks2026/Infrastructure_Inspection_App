from __future__ import annotations
import asyncio
import os
import shutil
import subprocess
import uuid
from typing import Optional

from sqlalchemy.orm import Session
from app.models.mission import Mission
from app.models.image import Image
from app.database import SessionLocal


ODM_DATASETS_PATH = os.environ.get("ODM_DATASETS_PATH", "./datasets")


def _run_odm_background(mission_id: str, job_id: str) -> None:
    """Run ODM processing in a background thread. Updates mission.odm_status on completion."""
    db = SessionLocal()
    try:
        mission = db.query(Mission).filter(Mission.id == mission_id).first()
        if not mission:
            return

        # Create dataset directory structure
        dataset_dir = os.path.join(ODM_DATASETS_PATH, mission_id)
        images_dir = os.path.join(dataset_dir, "images")
        os.makedirs(images_dir, exist_ok=True)

        # Copy/symlink mission images into dataset
        images = db.query(Image).filter(Image.mission_id == mission_id).all()
        for img in images:
            if img.stored_path:
                src = os.path.join("./storage", img.stored_path)
                dst = os.path.join(images_dir, img.filename)
                if os.path.exists(src) and not os.path.exists(dst):
                    try:
                        os.symlink(os.path.abspath(src), dst)
                    except OSError:
                        shutil.copy2(src, dst)

        # Run ODM via docker compose
        try:
            result = subprocess.run(
                [
                    "docker", "compose", "run", "--rm", "odm",
                    "--project-path", "/datasets", mission_id,
                ],
                capture_output=True, text=True, timeout=14400,  # 4 hour timeout
            )
            if result.returncode == 0:
                mission.odm_status = "completed"
            else:
                mission.odm_status = "failed"
        except (subprocess.TimeoutExpired, FileNotFoundError):
            # If docker not available, mark as failed gracefully
            mission.odm_status = "failed"

        db.commit()
    finally:
        db.close()


def start_odm_processing(mission_id: str, db: Session) -> str:
    """Start ODM processing for a mission. Returns job_id."""
    job_id = str(uuid.uuid4())

    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if mission:
        mission.odm_job_id = job_id
        mission.odm_status = "processing"
        db.commit()

    # Run in background thread to avoid blocking
    import threading
    t = threading.Thread(
        target=_run_odm_background,
        args=(mission_id, job_id),
        daemon=True,
    )
    t.start()

    return job_id


def get_odm_result_paths(mission_id: str) -> dict:
    """Return paths to ODM output files if they exist."""
    output_dir = os.path.join(ODM_DATASETS_PATH, mission_id, "odm_output")
    results = {}

    expected_files = {
        "orthomosaic": "odm_orthophoto/odm_orthophoto.tif",
        "mesh": "odm_texturing/odm_textured_model_geo.obj",
        "point_cloud": "odm_georeferencing/odm_georeferenced_model.las",
        "dem": "odm_dem/dsm.tif",
    }

    for key, rel_path in expected_files.items():
        full = os.path.join(output_dir, rel_path)
        if os.path.exists(full):
            results[key] = full

    return results
