import torch
import numpy as np
from PIL import Image
from transformers import pipeline
import logging

logger = logging.getLogger(__name__)

# Lazy load model
_depth_estimator = None

def get_depth_estimator():
    global _depth_estimator
    if _depth_estimator is None:
        logger.info("Loading depth estimation model (Intel/dpt-large)...")
        device = 0 if torch.cuda.is_available() else -1
        try:
            _depth_estimator = pipeline("depth-estimation", model="Intel/dpt-large", device=device)
            logger.info("Depth model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load depth model: {e}")
            raise
    return _depth_estimator

def estimate_depth(image_path: str) -> np.ndarray:
    """
    Load an image from disk, perform depth estimation, and return the depth map as a numpy array.
    """
    estimator = get_depth_estimator()
    image = Image.open(image_path).convert("RGB")
    
    # Process
    depth_output = estimator(image)
    depth_map = depth_output["depth"]
    
    # Return as numpy array
    return np.array(depth_map)
