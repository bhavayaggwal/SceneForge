# SceneForge — Project Requirement Document (PRD)

> **Version**: 1.0  
> **Last Updated**: 2026-08-10  
> **Status**: Draft — Awaiting Approval  

---

## 1. Product Vision

**SceneForge** is a **Phone-to-3D Scene Editor** that enables content creators and designers to turn short phone videos into editable, photorealistic 3D scenes — directly in the browser.

Users capture a short video of a real-world environment, upload it, and SceneForge reconstructs an interactive 3D scene they can explore, edit, and export for use in social media, presentations, AR experiences, and 3D workflows.

---

## 2. Target Audience

| Persona | Description | Key Need |
|---------|-------------|----------|
| **Content Creators** | YouTubers, social media creators, influencers | Quick 3D assets from real-world captures for thumbnails, videos, and stories |
| **Designers** | Graphic/UX/interior designers | Photorealistic 3D scenes for presentations, mockups, and portfolios |
| **Hobbyists** | 3D enthusiasts, AR tinkerers | Accessible entry point to 3D reconstruction without deep technical skills |

---

## 3. Core Features & Scope

### 3.1 MVP (Phase 1) — Video → 3D Scene Viewer

The MVP focuses on delivering an end-to-end pipeline from video upload to an interactive 3D scene viewer in the browser.

| Feature | Description | Priority |
|---------|-------------|----------|
| **Video Upload** | Drag-and-drop / file picker for `.mp4`, `.mov`, `.avi` | P0 |
| **Frame Extraction** | Extract frames from video using OpenCV | P0 |
| **3D Gaussian Splatting** | Reconstruct a 3D scene from extracted frames using a GPU-accelerated pipeline | P0 |
| **Interactive 3D Viewer** | Browser-based viewer to orbit, zoom, and explore the reconstructed scene | P0 |
| **Processing Status** | Real-time progress indicators during reconstruction | P0 |
| **Scene Export** | Export to GLTF/GLB and OBJ+MTL formats | P0 |
| **Authentication** | Google & GitHub OAuth login | P1 |
| **Premium Glassmorphism UI** | Dark theme with frosted glass panels, neon accents, micro-animations | P0 |

### 3.2 Phase 2 — Object Editing & NL Prompts (Post-MVP)

| Feature | Description | Priority |
|---------|-------------|----------|
| **Object Segmentation** | Select objects in the 3D scene via click or text prompt (SAM / Grounding DINO) | P1 |
| **Object Removal** | Remove selected objects with inpainting | P1 |
| **Object Replacement** | Replace objects using text-to-3D generation | P2 |
| **Scene History** | Undo/redo editing operations | P2 |
| **Multi-scene Management** | Save and manage multiple reconstructed scenes | P2 |

---

## 4. Technical Architecture

### 4.1 System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    BROWSER (Client)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │  Upload UI   │  │  3D Viewer   │  │  Auth (OAuth) │ │
│  │  (React)     │  │  (R3F/Three) │  │  (NextAuth)   │ │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘ │
│         │                 │                   │         │
│         └─────────┬───────┘───────────────────┘         │
│                   │  REST API / WebSocket               │
└───────────────────┼─────────────────────────────────────┘
                    │
┌───────────────────┼─────────────────────────────────────┐
│                   │       BACKEND (FastAPI)              │
│  ┌────────────────▼─────────────────────────────────┐   │
│  │              API Gateway (FastAPI)                │   │
│  │  /upload-video  /scene/{id}  /export  /auth      │   │
│  └──────────┬──────────┬────────────┬───────────────┘   │
│             │          │            │                    │
│  ┌──────────▼───┐ ┌────▼────┐ ┌────▼──────────────┐    │
│  │ Video        │ │ Scene   │ │ Export Pipeline    │    │
│  │ Processing   │ │ Storage │ │ (GLTF/OBJ)        │    │
│  │ (OpenCV)     │ │ (Local) │ │                    │    │
│  └──────┬───────┘ └─────────┘ └────────────────────┘    │
│         │                                               │
│  ┌──────▼──────────────────────────────────────────┐    │
│  │         3D Reconstruction Engine                 │    │
│  │  COLMAP (SfM) → 3D Gaussian Splatting           │    │
│  │  (GPU: NVIDIA Quadro P2000, 5GB VRAM)           │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Frontend Framework** | Next.js 15 (App Router) + React 19 + TypeScript | Already in use; modern, fast |
| **3D Rendering** | React Three Fiber (R3F) + Three.js | Best React integration for 3D; active ecosystem for Gaussian Splat viewers |
| **Styling** | Tailwind CSS + Custom CSS | Already in use; efficient for glassmorphism design |
| **Authentication** | NextAuth.js (Google + GitHub OAuth) | Standard for Next.js, easy OAuth setup |
| **Backend Framework** | FastAPI (Python) | Already in use; async support, great for ML workloads |
| **Video Processing** | OpenCV (`opencv-python-headless`) | Already in use; reliable frame extraction |
| **SfM / Camera Poses** | COLMAP | Gold standard for structure-from-motion; required for Gaussian Splatting |
| **3D Reconstruction** | 3D Gaussian Splatting (lightweight variant) | Fast, photorealistic, works within 5GB VRAM budget |
| **Depth Estimation** | `Intel/dpt-large` (Hugging Face) | Already integrated; useful for depth priors |
| **Task Queue** | Celery + Redis (or in-process background tasks for MVP) | Long-running reconstruction jobs |
| **Export** | `trimesh`, `pygltflib`, custom converters | GLTF/GLB and OBJ export |
| **Local Storage** | File system (SQLite metadata) | Sufficient for local-only deployment |

### 4.3 Hardware Constraints

| Resource | Specification | Impact |
|----------|--------------|--------|
| **GPU** | NVIDIA Quadro P2000 (5GB VRAM) | Must use memory-efficient Gaussian Splatting; limit point count; batch processing for frames |
| **RAM** | 16 GB | Limit concurrent reconstructions; stream large videos |
| **Deployment** | Local only (for now) | No cloud infra needed; everything runs on `localhost` |

**VRAM Strategy**: With 5GB VRAM, we will:
- Use a lightweight 3D Gaussian Splatting implementation (e.g., `gsplat` or mini-splatting)
- Limit input video to ~100-200 frames for reconstruction
- Use half-precision (FP16) where possible
- Downscale frames if needed (e.g., 960×540 or lower)
- Process COLMAP with reduced feature extraction settings

---

## 5. User Flows

### 5.1 Core Flow — Video to 3D Scene

```
1. User lands on SceneForge homepage
2. User signs in via Google or GitHub OAuth
3. User uploads a short video (drag-and-drop or file picker)
4. System validates video (format, length, size)
5. System extracts frames from video
6. System runs COLMAP SfM to estimate camera poses
7. System runs 3D Gaussian Splatting training
8. Progress bar updates in real-time via WebSocket
9. Reconstructed scene loads in the 3D viewer
10. User orbits, zooms, and explores the scene
11. User exports to GLTF/GLB or OBJ+MTL
12. File downloads to user's machine
```

### 5.2 Error States

| Error | Handling |
|-------|----------|
| Unsupported video format | Toast notification with supported formats |
| Video too long (>60s) | Warning + option to trim |
| COLMAP fails (not enough features) | Inform user to recapture with more overlap |
| GPU OOM during training | Auto-reduce resolution and retry |
| Processing timeout | Allow resume from last checkpoint |

---

## 6. UI/UX Design

### 6.1 Design System

| Element | Specification |
|---------|--------------|
| **Theme** | Dark mode primary (deep navy/charcoal backgrounds) |
| **Style** | Premium glassmorphism — frosted glass panels with `backdrop-filter: blur()` |
| **Accents** | Neon gradient accents (cyan → purple → magenta) |
| **Typography** | Inter or Outfit (Google Fonts), clean sans-serif |
| **Animations** | Smooth micro-animations on hover, transitions, loading states |
| **Cards** | Frosted glass cards with subtle borders and glow effects |
| **Buttons** | Gradient-filled with hover glow and press animations |
| **Icons** | Lucide React or Phosphor Icons |

### 6.2 Key Screens

1. **Landing / Home Page** — Hero section with animated 3D preview, CTA to upload
2. **Upload Page** — Drag-and-drop zone with glassmorphism card, file validation feedback
3. **Processing Page** — Progress stages (Extracting → SfM → Training → Rendering), animated progress bar
4. **3D Viewer Page** — Full-screen interactive 3D scene viewer with orbit controls, toolbar for export/settings
5. **Export Modal** — Format selection (GLTF/GLB, OBJ), quality settings, download button
6. **Auth Pages** — Sign-in with Google/GitHub, minimal and elegant

---

## 7. API Endpoints

### 7.1 Video & Scene

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload-video` | Upload video file, returns `job_id` |
| `GET` | `/api/job/{job_id}/status` | Get processing status and progress |
| `WS` | `/ws/job/{job_id}` | WebSocket for real-time progress updates |
| `GET` | `/api/scene/{scene_id}` | Get scene metadata and asset URLs |
| `GET` | `/api/scene/{scene_id}/splat` | Download `.ply` / splat data for viewer |
| `POST` | `/api/scene/{scene_id}/export` | Export scene to specified format |
| `GET` | `/api/scene/{scene_id}/download/{format}` | Download exported file |

### 7.2 Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/auth/providers` | List available OAuth providers |
| `POST` | `/api/auth/callback/{provider}` | OAuth callback handler |
| `GET` | `/api/auth/session` | Get current user session |

---

## 8. Project Structure (Consolidated)

```
SceneForge/
├── README.md
├── PRD.md                          # This document
├── .env.local                      # Environment variables
├── LICENSE
│
├── scene-forge-frontend/           # Next.js 15 application
│   ├── package.json
│   ├── next.config.ts
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   └── src/
│       ├── app/
│       │   ├── layout.tsx          # Root layout (fonts, metadata, theme)
│       │   ├── globals.css         # Global styles + design tokens
│       │   ├── page.tsx            # Landing / Home page
│       │   ├── upload/
│       │   │   └── page.tsx        # Upload page
│       │   ├── processing/
│       │   │   └── page.tsx        # Processing status page
│       │   ├── viewer/
│       │   │   └── page.tsx        # 3D scene viewer page
│       │   └── auth/
│       │       ├── signin/
│       │       │   └── page.tsx
│       │       └── callback/
│       │           └── page.tsx
│       ├── components/
│       │   ├── ui/                 # Reusable UI components
│       │   │   ├── Button.tsx
│       │   │   ├── Card.tsx
│       │   │   ├── ProgressBar.tsx
│       │   │   ├── Modal.tsx
│       │   │   └── Toast.tsx
│       │   ├── upload/
│       │   │   └── DropZone.tsx    # Video upload dropzone
│       │   ├── viewer/
│       │   │   ├── SceneCanvas.tsx  # R3F Canvas wrapper
│       │   │   ├── SplatRenderer.tsx # Gaussian Splat renderer
│       │   │   └── ViewerToolbar.tsx
│       │   └── layout/
│       │       ├── Navbar.tsx
│       │       └── Footer.tsx
│       ├── lib/
│       │   ├── api.ts              # API client utilities
│       │   └── auth.ts             # NextAuth configuration
│       └── types/
│           └── index.ts            # TypeScript type definitions
│
├── scene-forge-backend/            # FastAPI application
│   ├── requirements.txt
│   ├── main.py                     # FastAPI entry point
│   ├── config.py                   # Configuration & env vars
│   ├── routers/
│   │   ├── video.py                # Video upload & processing endpoints
│   │   ├── scene.py                # Scene retrieval & export endpoints
│   │   └── auth.py                 # Authentication endpoints
│   ├── services/
│   │   ├── video_processor.py      # Frame extraction & validation
│   │   ├── colmap_runner.py        # COLMAP SfM pipeline
│   │   ├── gaussian_splatting.py   # 3D Gaussian Splatting training
│   │   ├── exporter.py            # GLTF/OBJ export logic
│   │   └── depth_estimator.py     # Depth estimation (existing)
│   ├── models/
│   │   ├── scene.py                # Scene data models
│   │   └── job.py                  # Processing job models
│   ├── tasks/
│   │   └── reconstruction.py       # Background reconstruction tasks
│   └── storage/
│       └── local.py                # Local file storage manager
│
└── data/                           # Local data directory (gitignored)
    ├── uploads/                    # Uploaded videos
    ├── frames/                     # Extracted frames
    ├── colmap/                     # COLMAP outputs
    ├── splats/                     # Trained Gaussian Splat data
    └── exports/                    # Exported 3D files
```

---

## 9. Development Phases & Milestones

### Phase 1 — MVP: Video → 3D Viewer (Target: ~1 week rapid prototype)

| Step | Task | Duration |
|------|------|----------|
| 1 | **Codebase consolidation** — Clean up duplicates, establish project structure | Day 1 |
| 2 | **UI overhaul** — Implement glassmorphism design system, landing page, upload UI | Day 1-2 |
| 3 | **Backend pipeline** — Video processing, COLMAP integration, frame management | Day 2-3 |
| 4 | **Gaussian Splatting** — Integrate lightweight GS training pipeline | Day 3-4 |
| 5 | **3D Viewer** — R3F-based Gaussian Splat viewer with orbit controls | Day 4-5 |
| 6 | **Export** — GLTF/GLB and OBJ export from reconstructed scene | Day 5 |
| 7 | **WebSocket progress** — Real-time processing status updates | Day 5-6 |
| 8 | **Auth** — NextAuth with Google + GitHub OAuth | Day 6 |
| 9 | **Polish & Integration Testing** — End-to-end flow, error handling, UX refinements | Day 6-7 |

### Phase 2 — Object Editing (Post-MVP)
- SAM/Grounding DINO integration for object segmentation
- Inpainting pipeline for object removal
- Text-to-3D for object replacement
- Scene management and history

### Phase 3 — Production Readiness (Future)
- Cloud deployment with GPU instances
- User dashboard and scene gallery
- Collaboration features
- Performance optimization and caching

---

## 10. Non-Functional Requirements

| Requirement | Specification |
|-------------|--------------|
| **Performance** | Scene reconstruction < 10 min for 10-second video |
| **Video Limits** | Max 60 seconds, max 500MB, formats: MP4, MOV, AVI |
| **Browser Support** | Chrome 90+, Firefox 90+, Safari 15+ (WebGL2 required) |
| **Responsive** | Desktop-first, functional on tablets |
| **Accessibility** | WCAG 2.1 AA compliance for UI elements |
| **Security** | OAuth 2.0, CORS configured, file upload validation |

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| 5GB VRAM insufficient for large scenes | Reconstruction fails / OOM | Auto-downscale, limit frame count, use mini-splatting |
| COLMAP installation complexity on Windows | Setup friction | Provide pre-built binaries or Docker container |
| Long reconstruction times | Poor UX | WebSocket progress, background processing, estimated time display |
| WebGL Gaussian Splat rendering performance | Laggy viewer | LOD rendering, limit splat count, progressive loading |

---

## 12. Success Metrics (MVP)

| Metric | Target |
|--------|--------|
| Upload → 3D scene pipeline works end-to-end | ✅ Functional |
| 3D viewer renders reconstructed scene with orbit controls | ✅ Interactive |
| Processing a 10s video completes within 10 minutes | ✅ Under threshold |
| Export to GLTF/GLB produces a valid, importable file | ✅ Compatible with Blender/Three.js |
| UI feels premium (glassmorphism, animations, dark theme) | ✅ Visual polish |

---

*This PRD is a living document. It will be updated as development progresses and requirements evolve.*
