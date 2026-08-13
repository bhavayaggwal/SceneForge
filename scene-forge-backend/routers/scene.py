from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse
from typing import List
import os
from models.scene import get_scene, list_scenes, Scene
from services.exporter import export_to_gltf, export_to_obj
from storage.local import get_export_dir
from config import get_settings, Settings

router = APIRouter()

@router.get("/scene/{scene_id}", response_model=Scene)
async def get_scene_endpoint(scene_id: str):
    scene = get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    return scene

@router.get("/scene/{scene_id}/splat")
async def get_scene_splat(scene_id: str):
    scene = get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
        
    if not os.path.exists(scene.splat_path):
        raise HTTPException(status_code=404, detail="Splat file not found on disk")
        
    return FileResponse(scene.splat_path, filename=f"{scene_id}.ply", media_type="application/octet-stream")

@router.post("/scene/{scene_id}/export")
async def export_scene(scene_id: str, format: str = "gltf", settings: Settings = Depends(get_settings)):
    scene = get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
        
    if not os.path.exists(scene.splat_path):
        raise HTTPException(status_code=404, detail="Splat file not found on disk")
        
    export_dir = get_export_dir(scene_id, settings)
    
    if format.lower() in ["gltf", "glb"]:
        output_path = os.path.join(export_dir, f"{scene_id}.glb")
        export_to_gltf(scene.splat_path, output_path)
    elif format.lower() == "obj":
        output_path = os.path.join(export_dir, f"{scene_id}.obj")
        export_to_obj(scene.splat_path, output_path)
    else:
        raise HTTPException(status_code=400, detail="Unsupported format. Use 'gltf' or 'obj'")
        
    # Return a URL to download (simplification for MVP)
    return {"message": "Export complete", "download_url": f"/api/scene/{scene_id}/download/{format.lower()}"}

@router.get("/scene/{scene_id}/download/{format}")
async def download_exported_scene(scene_id: str, format: str, settings: Settings = Depends(get_settings)):
    scene = get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
        
    export_dir = get_export_dir(scene_id, settings)
    if format.lower() in ["gltf", "glb"]:
        filepath = os.path.join(export_dir, f"{scene_id}.glb")
    elif format.lower() == "obj":
        filepath = os.path.join(export_dir, f"{scene_id}.obj")
    else:
        raise HTTPException(status_code=400, detail="Unsupported format")
        
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Exported file not found. Did you export it first?")
        
    return FileResponse(filepath, filename=os.path.basename(filepath), media_type="application/octet-stream")

@router.get("/scenes", response_model=List[Scene])
async def list_scenes_endpoint():
    return list_scenes()
