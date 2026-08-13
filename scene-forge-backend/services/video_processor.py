import cv2
import os
import logging
from typing import Tuple, Callable
from pathlib import Path

logger = logging.getLogger(__name__)

async def extract_frames(video_path: str, output_dir: str, settings, progress_callback: Callable[[float], None] = None) -> Tuple[int, dict]:
    """
    Extract frames using OpenCV.
    Sample every Nth frame based on settings.
    Downscale based on settings.
    """
    logger.info(f"Extracting frames from {video_path} to {output_dir}")
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video file: {video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps == 0:
        fps = 30.0
        
    duration = total_frames / fps
    
    orig_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    out_width = orig_width // settings.IMAGE_DOWNSCALE
    out_height = orig_height // settings.IMAGE_DOWNSCALE

    frame_count = 0
    extracted_count = 0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
            
        if frame_count % settings.FRAME_SAMPLE_RATE == 0:
            if settings.IMAGE_DOWNSCALE > 1:
                frame = cv2.resize(frame, (out_width, out_height), interpolation=cv2.INTER_AREA)
                
            frame_filename = os.path.join(output_dir, f"frame_{extracted_count:05d}.png")
            cv2.imwrite(frame_filename, frame)
            extracted_count += 1
            
            if progress_callback and extracted_count % 10 == 0:
                progress = min(100.0, (frame_count / total_frames) * 100.0)
                progress_callback(progress)
                
            if extracted_count >= settings.MAX_FRAMES:
                logger.info(f"Reached max frames limit ({settings.MAX_FRAMES})")
                break
                
        frame_count += 1

    cap.release()
    
    if progress_callback:
        progress_callback(100.0)
        
    metadata = {
        "fps": fps,
        "duration": duration,
        "original_resolution": (orig_width, orig_height),
        "output_resolution": (out_width, out_height)
    }
    
    logger.info(f"Extracted {extracted_count} frames")
    return extracted_count, metadata
