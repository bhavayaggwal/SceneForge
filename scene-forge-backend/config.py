from functools import lru_cache
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # Directories
    UPLOAD_DIR: str = "../data/uploads"
    FRAMES_DIR: str = "../data/frames"
    COLMAP_DIR: str = "../data/colmap"
    SPLATS_DIR: str = "../data/splats"
    EXPORTS_DIR: str = "../data/exports"

    # COLMAP settings
    COLMAP_BINARY: str = "colmap"

    # Processing parameters
    MAX_VIDEO_DURATION_SECONDS: int = 30
    MAX_VIDEO_SIZE_MB: int = 500
    MAX_FRAMES: int = 150
    FRAME_SAMPLE_RATE: int = 2
    GS_ITERATIONS: int = 7000
    GS_SH_DEGREE: int = 2
    IMAGE_DOWNSCALE: int = 2

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:3001"]

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

@lru_cache()
def get_settings() -> Settings:
    return Settings()
