import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Depends
from models.job import create_job, get_job, JobStatus, ProcessingStage
from config import get_settings, Settings
from storage.local import get_upload_path
from tasks.reconstruction import run_reconstruction
import aiofiles

router = APIRouter()

@router.post("/upload-video", response_model=dict)
async def upload_video(
    background_tasks: BackgroundTasks,
    video_file: UploadFile = File(...),
    settings: Settings = Depends(get_settings)
):
    if not video_file.filename.endswith(('.mp4', '.mov', '.avi')):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload a video (.mp4, .mov, .avi).")

    # In a real app we might check content-length for size limit here 
    # but FastAPI doesn't easily expose it on UploadFile unless fully read
    
    job_id = str(uuid.uuid4())
    job = create_job(job_id)
    
    # Save the uploaded video
    filename = f"{job_id}.mp4"
    video_path = get_upload_path(filename, settings)
    
    try:
        async with aiofiles.open(video_path, 'wb') as out_file:
            content = await video_file.read()
            if len(content) > settings.MAX_VIDEO_SIZE_MB * 1024 * 1024:
                raise HTTPException(status_code=413, detail=f"File too large. Max size is {settings.MAX_VIDEO_SIZE_MB}MB.")
            await out_file.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save video: {str(e)}")
        
    # Start background task
    background_tasks.add_task(run_reconstruction, job_id, video_path, settings)
    
    return {"job_id": job_id, "message": "Video uploaded and processing started"}

@router.get("/job/{job_id}/status", response_model=JobStatus)
async def get_job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
