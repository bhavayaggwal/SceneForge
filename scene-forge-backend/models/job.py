from enum import Enum
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field

class ProcessingStage(str, Enum):
    UPLOADING = "UPLOADING"
    EXTRACTING = "EXTRACTING"
    SFM = "SFM"
    TRAINING = "TRAINING"
    RENDERING = "RENDERING"
    EXPORTING = "EXPORTING"
    COMPLETE = "COMPLETE"
    FAILED = "FAILED"

class JobStatus(BaseModel):
    id: str
    status: ProcessingStage = ProcessingStage.UPLOADING
    progress: float = 0.0  # 0 to 100
    current_stage: str = ""
    message: str = ""
    scene_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    error: Optional[str] = None

# In-memory job store for MVP
_jobs_store = {}

def create_job(job_id: str) -> JobStatus:
    job = JobStatus(id=job_id)
    _jobs_store[job_id] = job
    return job

def get_job(job_id: str) -> Optional[JobStatus]:
    return _jobs_store.get(job_id)

def update_job(job_id: str, **kwargs) -> Optional[JobStatus]:
    job = _jobs_store.get(job_id)
    if job:
        job_data = job.model_dump()
        job_data.update(kwargs)
        job_data["updated_at"] = datetime.utcnow()
        updated_job = JobStatus(**job_data)
        _jobs_store[job_id] = updated_job
        return updated_job
    return None
