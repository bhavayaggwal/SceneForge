from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import logging
from contextlib import asynccontextmanager

from config import get_settings
from storage.local import init_storage
from routers import video, scene, websocket
from services.depth_estimator import get_depth_estimator

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting up SceneForge Backend...")
    settings = get_settings()
    init_storage(settings)
    
    # Preload depth estimator if desired
    try:
        get_depth_estimator()
    except Exception as e:
        logger.warning(f"Could not preload depth estimator: {e}")
        
    yield
    # Shutdown
    logger.info("Shutting down SceneForge Backend...")

app = FastAPI(
    title="SceneForge API",
    description="Backend for 3D reconstruction pipeline.",
    version="0.2.0",
    lifespan=lifespan
)

settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(video.router, prefix="/api", tags=["video"])
app.include_router(scene.router, prefix="/api", tags=["scene"])
app.include_router(websocket.router, tags=["websocket"])

@app.get("/api/health", tags=["health"])
async def health_check():
    return {"status": "healthy", "version": app.version}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)