from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field

class Scene(BaseModel):
    id: str
    name: str
    splat_path: str
    point_count: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)

# In-memory scene store for MVP
_scenes_store = {}

def create_scene(scene: Scene) -> Scene:
    _scenes_store[scene.id] = scene
    return scene

def get_scene(scene_id: str) -> Optional[Scene]:
    return _scenes_store.get(scene_id)

def list_scenes() -> List[Scene]:
    return list(_scenes_store.values())
