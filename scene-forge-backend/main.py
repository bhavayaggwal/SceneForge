from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import torch
import cv2
import numpy as np
from PIL import Image
from transformers import pipeline
import uvicorn
import os

# Initialize FastAPI app
app = FastAPI(
    title="SceneForge API",
    description="Backend for processing video into 3D scenes.",
    version="0.1.0"
)

#Configure CORS (Cross-Origin Resource Sharing)
#We'll allow all origins for development. In production, only our specific frontend should be allowed.
origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load a pre-trained depth estimation model from Hugging Face
try:
    depth_estimator = pipeline("depth-estimation", model="Intel/dpt-large")
    print("Depth estimation model loaded successfully!")
except Exception as e:
    print(f"Error loading depth model: {e}")
    depth_estimator = None

@app.post("/upload-video/")
async def upload_video(video_file: UploadFile = File(...)):
    if not depth_estimator:
        raise HTTPException(status_code=503, detail="Model is not ready.")

    if not video_file.filename.endswith(('.mp4', '.mov', '.avi')):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload a video.")

    try:
        # Save the uploaded video temporarily
        video_path = f"temp_{video_file.filename}"
        with open(video_path, "wb") as f:
            f.write(await video_file.read())

        # Process the video frame by frame
        cap = cv2.VideoCapture(video_path)
        frames = []
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        cap.release()
        os.remove(video_path)

        if not frames:
            raise HTTPException(status_code=400, detail="Could not read video frames.")

        # Process a single frame to demonstrate the pipeline
        first_frame = Image.fromarray(frames[0])
        
        # Perform depth estimation
        depth_output = depth_estimator(first_frame)
        depth_map = depth_output["depth"]
        
        # Convert depth map to a list of lists for JSON serialization
        depth_map_array = np.array(depth_map)
        
        # For the MVP, we will just return a simple confirmation and some metadata.
        # The full 3D reconstruction part is more complex and will be for later.
        
        # A simple placeholder response
        return JSONResponse(content={
            "message": "Video processed successfully!",
            "processed_frames": len(frames),
            "depth_map_shape": list(depth_map_array.shape),
            "details": "Depth estimation performed on the first frame. 3D reconstruction is the next step!"
        })

    except Exception as e:
        print(f"Processing error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Run the server with Uvicorn
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)