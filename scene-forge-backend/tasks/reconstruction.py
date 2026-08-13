import asyncio
import logging
import traceback
from models.job import update_job, ProcessingStage
from models.scene import Scene, create_scene
from services.video_processor import extract_frames
from services.colmap_runner import run_colmap
from services.gaussian_splatting import train_gaussians
from storage.local import get_frames_dir, get_colmap_dir, get_splat_dir, cleanup_job_files
from routers.websocket import manager

logger = logging.getLogger(__name__)

async def _update_job_and_broadcast(job_id: str, **kwargs):
    updated = update_job(job_id, **kwargs)
    if updated:
        await manager.broadcast(job_id, updated.model_dump(mode="json"))

async def run_reconstruction(job_id: str, video_path: str, settings):
    logger.info(f"Starting reconstruction pipeline for job {job_id}")
    try:
        # EXTRACTING
        await _update_job_and_broadcast(job_id, status=ProcessingStage.EXTRACTING, current_stage="Extracting frames", progress=0.0)
        
        frames_dir = get_frames_dir(job_id, settings)
        
        def frame_progress(p: float):
            # Fire and forget update
            asyncio.create_task(_update_job_and_broadcast(job_id, progress=p))
            
        num_frames, metadata = await extract_frames(video_path, frames_dir, settings, frame_progress)
        
        if num_frames == 0:
            raise ValueError("No frames extracted from video")
            
        # SFM
        await _update_job_and_broadcast(job_id, status=ProcessingStage.SFM, current_stage="Running COLMAP SfM", progress=0.0)
        colmap_dir = get_colmap_dir(job_id, settings)
        
        def colmap_progress(p: float):
            asyncio.create_task(_update_job_and_broadcast(job_id, progress=p))
            
        await run_colmap(frames_dir, colmap_dir, settings, colmap_progress)
        
        # TRAINING
        await _update_job_and_broadcast(job_id, status=ProcessingStage.TRAINING, current_stage="Training 3D Gaussian Splats", progress=0.0)
        splat_dir = get_splat_dir(job_id, settings)
        
        def gs_progress(p: float):
            asyncio.create_task(_update_job_and_broadcast(job_id, progress=p))
            
        splat_path = await train_gaussians(colmap_dir, splat_dir, settings, gs_progress)
        
        # RENDERING (skip or minimal step)
        await _update_job_and_broadcast(job_id, status=ProcessingStage.RENDERING, current_stage="Rendering preview", progress=100.0)
        
        # COMPLETE
        scene = Scene(
            id=job_id,
            name=f"Scene {job_id[:8]}",
            splat_path=splat_path,
            point_count=0  # For MOCK
        )
        create_scene(scene)
        
        await _update_job_and_broadcast(
            job_id, 
            status=ProcessingStage.COMPLETE, 
            current_stage="Complete", 
            progress=100.0,
            scene_id=scene.id
        )
        
        # Cleanup
        cleanup_job_files(job_id, settings)
        
    except Exception as e:
        logger.error(f"Reconstruction failed for job {job_id}: {str(e)}\n{traceback.format_exc()}")
        await _update_job_and_broadcast(
            job_id, 
            status=ProcessingStage.FAILED, 
            current_stage="Failed",
            error=str(e)
        )
        # Cleanup on failure
        cleanup_job_files(job_id, settings)
