import os
import shutil
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

def init_storage(settings) -> None:
    dirs = [
        settings.UPLOAD_DIR,
        settings.FRAMES_DIR,
        settings.COLMAP_DIR,
        settings.SPLATS_DIR,
        settings.EXPORTS_DIR
    ]
    for d in dirs:
        Path(d).mkdir(parents=True, exist_ok=True)
    logger.info("Storage directories initialized.")

def get_upload_path(filename: str, settings) -> str:
    return str(Path(settings.UPLOAD_DIR) / filename)

def get_frames_dir(job_id: str, settings) -> str:
    path = Path(settings.FRAMES_DIR) / job_id
    path.mkdir(parents=True, exist_ok=True)
    return str(path)

def get_colmap_dir(job_id: str, settings) -> str:
    path = Path(settings.COLMAP_DIR) / job_id
    path.mkdir(parents=True, exist_ok=True)
    return str(path)

def get_splat_dir(job_id: str, settings) -> str:
    path = Path(settings.SPLATS_DIR) / job_id
    path.mkdir(parents=True, exist_ok=True)
    return str(path)

def get_export_dir(job_id: str, settings) -> str:
    path = Path(settings.EXPORTS_DIR) / job_id
    path.mkdir(parents=True, exist_ok=True)
    return str(path)

def cleanup_job_files(job_id: str, settings) -> None:
    try:
        upload_file = Path(settings.UPLOAD_DIR) / f"{job_id}.mp4"
        if upload_file.is_file():
            upload_file.unlink(missing_ok=True)
        shutil.rmtree(Path(settings.FRAMES_DIR) / job_id, ignore_errors=True)
        shutil.rmtree(Path(settings.COLMAP_DIR) / job_id, ignore_errors=True)
        # Keep splat and exports typically, but we can clean up if needed
    except Exception as e:
        logger.error(f"Error cleaning up files for job {job_id}: {e}")
