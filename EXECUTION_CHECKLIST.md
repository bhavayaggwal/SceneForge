# SceneForge — MVP Execution Checklist

> ⚠️ **SUPERSEDED (2026-10-24):** The project pivoted to a local "talk to a place" spatial agent. See `docs/HANDOFF-2026-10-24.md`. This file is kept only for the audit findings about the old pipeline.

> Created 2026-10-24 from a full read of PRD.md, `.agent-state.md`, and every source file.
> Goal: PRD §12 success metrics — real video → real 3D splat in the browser → valid GLB/OBJ, on the local Quadro P2000.

## Where things actually stand

| Area | State | Evidence |
|---|---|---|
| Frontend build | ✅ `next build` passes (only unused-var lint warnings) | 5 routes prerender |
| UI shell (landing, upload, processing, viewer, modal, toasts) | ✅ Done, glassmorphism in place | `src/app/*` |
| Upload → job → WS/polling progress | 🟡 Wired, has bugs (below) | `routers/video.py`, `processing/page.tsx` |
| Frame extraction (OpenCV) | 🟡 Works, but only samples the first ~10 s of video | `video_processor.py` |
| COLMAP SfM | 🟡 Commands written, **COLMAP not installed** | `colmap_runner.py`, `which colmap` → none |
| 3D Gaussian Splatting | 🔴 **MOCK** — sleeps 30 s, writes a 3-point PLY | `gaussian_splatting.py` |
| Viewer | 🔴 **Demo torus knot** — never loads the scene's splat | `Scene3DContent.tsx` |
| Export GLB/OBJ | 🔴 **MOCK** files; frontend/backend contract broken | `exporter.py`, `api.ts` |
| Auth (P1) | 🔴 Not started; "Sign In" button does nothing | `Navbar.tsx` |
| Persistence | 🔴 In-memory dicts; a backend restart loses every scene | `models/job.py`, `models/scene.py` |
| Python env | 🔴 Default `python` is 3.14 with no deps. `py -3.13` has fastapi/torch, but **torch is CPU-only** and pydantic-settings, aiofiles, trimesh, pygltflib are missing | |
| GPU | Quadro P2000, 5 GB, driver 573.06. No CUDA toolkit (`nvcc`) | `nvidia-smi` |

**Critical path:** the two 🔴 core items (real training plus a real viewer). Everything else is small fixes. Start the training-engine spike (2.2) on day 1, in parallel with the bug fixes.

---

## Phase 0 — Environment & repo hygiene (≈2 h)

- [ ] Create `scene-forge-backend/.venv` with **Python 3.13** (3.14 has poor ML wheel coverage). Move `requirements.txt` into the backend folder, as PRD §8 specifies.
- [ ] Install torch with a CUDA build that still supports **Pascal (sm_61)**, e.g. `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126`. Verify with `torch.cuda.is_available()` and check that `torch.cuda.get_arch_list()` contains `sm_61`. Newer CUDA 12.8+ builds drop older architectures.
- [ ] `pip install -r requirements.txt`, then confirm `python -c "import main"` succeeds.
- [ ] Install the **COLMAP Windows CUDA binary** (github.com/colmap/colmap/releases). Set `COLMAP_BINARY` in `scene-forge-backend/.env` and check `colmap help`.
- [ ] Add a root `.gitignore` (`__pycache__/`, `*.pyc`, `.venv/`, `.env*`, `data/*`). Run `git rm -r --cached` on the 30 committed `.pyc` files.
- [ ] Delete the stray empty `scene-forge-frontend/css` file.
- [ ] Remove the duplicate PostCSS config. Tailwind **3.4.1** is installed and `globals.css` uses v3 `@tailwind` directives, so keep `postcss.config.js`, delete `postcss.config.mjs`, and drop the `@tailwindcss/postcss` devDependency.
- [ ] Add `scene-forge-frontend/.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:8000`.
- [ ] Capture 2–3 **test videos** now (10 s, slow orbit around an object, good light). Every later phase needs them.

## Phase 1 — Fix known integration bugs (≈½ day, parallel with 2.1)

Backend
- [ ] **Export contract is broken.** The frontend POSTs a JSON body `{format}`, but the backend reads `format` as a query param, so every export defaults to gltf. The backend also returns JSON, and the frontend saves that JSON as the "file". Fix: POST `?format=`, then GET the `download_url` (or return the `FileResponse` directly).
- [ ] **Extension check is case-sensitive.** iPhone `.MOV` gets rejected. Lowercase the extension and keep the original suffix instead of renaming everything to `.mp4`. Update `cleanup_job_files` to match.
- [ ] **Upload reads the whole file into RAM** (up to 500 MB). Stream it in chunks with `aiofiles` and abort past the size limit.
- [ ] **Duration limit is never enforced.** Also, config says 30 s and the PRD says 60 s, so pick one. Validate with `cv2` right after upload and return 400 with a clear message.
- [ ] **Frame sampling only covers the first ~10 s.** With `FRAME_SAMPLE_RATE=2` and `MAX_FRAMES=150` at 30 fps, extraction stops at frame 300. Compute `stride = max(1, total_frames // MAX_FRAMES)` so frames span the whole clip.
- [ ] **Extraction progress never broadcasts.** `frame_progress` runs inside `asyncio.to_thread`, so `get_running_loop()` raises and the error is swallowed. Capture the loop up front and use `asyncio.run_coroutine_threadsafe(...)`.
- [ ] **WS race:** a client that connects after an update misses it. Send the current `JobStatus` immediately in `websocket_endpoint` after `connect`.
- [ ] Use COLMAP's **`sequential_matcher`** instead of `exhaustive_matcher`. Video frames are ordered, so this is much faster and is needed for the <10 min target. Add `--SiftExtraction.use_gpu 1`.
- [ ] After `mapper`, check that `sparse/0` exists. If not, raise the PRD error text: "Not enough features, recapture with more overlap."
- [ ] Stop preloading `Intel/dpt-large` at startup. It is a ~1.3 GB download and the pipeline never uses it. Make it lazy or put it behind a flag.
- [ ] Persist jobs and scenes in **SQLite** (or a JSON file under `data/`) so viewer links survive restarts.
- [ ] Mark stale jobs FAILED on startup.

Frontend
- [ ] Upload page says "MP4, MOV, WebM", but the backend rejects WebM. Change it to MP4, MOV, AVI and add a client-side size, type, and duration check.
- [ ] Make "Reset View" actually reset the camera (OrbitControls ref → `reset()`).
- [ ] Remove the processing page's duplicate failure toast (it fires on every WS and poll message after failure).
- [ ] Clean up the unused `_` catch vars (lint warnings).

## Phase 2 — Real reconstruction (≈1.5–2 days, CRITICAL PATH)

**2.1 COLMAP spike (day 1)**
- [ ] Run the 4 COLMAP commands by hand on a test video's frames. Record the time per step and the registered image count.
- [ ] Tune for the P2000: `max_num_features` 4096, `max_image_size` 1600. Confirm that `image_undistorter` output (`images/`, `sparse/`) is what the trainer expects.

**2.2 Pick the 3DGS training engine (decision gate, day 1–2).** Time-box each option to ~2 h. Take the first one that trains on the P2000:
- [ ] **A. Brush** (Rust/WebGPU, prebuilt Windows binary, no CUDA toolkit needed). Point it at the COLMAP dir, export `.ply`. *Lowest setup risk.*
- [ ] **B. `gsplat`** using a **prebuilt wheel** matching your torch+CUDA (docs.gsplat.studio/whl), then its `simple_trainer.py`. Building from source needs the CUDA toolkit and MSVC, which are not installed.
- [ ] **C. OpenSplat** (C++, CUDA or CPU fallback, COLMAP input → `.ply`).
- [ ] Record the choice and its reasons in PRD §4.2.

**2.3 Integrate**
- [ ] Replace the mock `train_gaussians` with `asyncio.create_subprocess_exec` running the chosen trainer. Parse stdout iteration lines into `progress_callback`.
- [ ] Use VRAM-safe defaults: `GS_ITERATIONS` 7000, SH degree ≤2, cap the Gaussian count, keep `IMAGE_DOWNSCALE` 2.
- [ ] **OOM retry** (PRD §5.2): on CUDA OOM, double the downscale and retry once.
- [ ] Set `Scene.point_count` from the PLY header.
- [ ] Optionally convert PLY → `.splat`/`.ksplat` for a smaller viewer download.
- [ ] Time a full 10 s video. It must be **< 10 min** (PRD §10).

## Phase 3 — Real splat viewer (≈1 day, can start once any real `.ply` exists)

- [ ] Add a Three.js Gaussian-splat renderer that works under R3F: **Spark** (`@sparkjsdev/spark`) or `@mkkellogg/gaussian-splats-3d`. Spike both against one PLY and keep the one that runs smoothly.
- [ ] New `components/viewer/SplatRenderer.tsx` (PRD §8) loads `${API_URL}/api/scene/{id}/splat`, with a loading/progress overlay and an error toast.
- [ ] `/viewer` without `sceneId` loads a bundled demo splat from `public/demo/` (this is the landing page's "View Demo"). Remove the torus knot.
- [ ] Auto-frame the camera on the scene's bounds. Make reset and the grid toggle work, and hold ≥30 fps on the target machine.

## Phase 4 — Real export (≈½ day)

- [ ] Parse the PLY with `numpy` or `plyfile`. Convert colors from SH DC: `rgb = clip(0.5 + 0.28209479 * f_dc, 0, 1)`. Filter low-opacity Gaussians (`sigmoid(opacity) > 0.1`).
- [ ] **GLB:** point cloud with vertex colors via `trimesh.PointCloud(...).export('.glb')`.
- [ ] **OBJ+MTL:** `v x y z r g b` lines plus a `.mtl`, delivered as a `.zip` (two files can't go in one download).
- [ ] Validate that the files open in Blender and the three.js editor (PRD §12). *Note:* splats become point clouds, not meshes. Poisson meshing (Open3D) is a stretch goal, so say so in the export modal copy.

## Phase 5 — Auth (P1; cut it if time is short)

- [ ] NextAuth v5 (Auth.js) with Google and GitHub providers, `/auth/signin` page, and a working Navbar Sign In/Out with the user avatar.
- [ ] Create OAuth apps (callback `http://localhost:3000/api/auth/callback/{provider}`). Put secrets in `.env.local`.
- [ ] Optional for a local MVP: require a session on `/upload`. Backend JWT verification can wait for Phase 3 of the PRD.

## Phase 6 — E2E, polish, ship (≈½ day)

- [ ] Full run with all 3 test videos: upload → progress through every stage → viewer → GLB and OBJ download.
- [ ] Exercise every PRD §5.2 error state: bad format, too long, COLMAP failure, OOM, backend down mid-job.
- [ ] Accessibility pass: `aria-label` on icon-only toolbar buttons, keyboard-selectable export options (they are currently `div onClick`), visible focus rings.
- [ ] Rewrite README with setup steps (venv, torch cu126, COLMAP, trainer, `npm run dev`, `uvicorn`) and add a single `dev` script that starts both servers.
- [ ] Update `.agent-state.md` and the PRD status, then tag `v0.1-mvp`.

---

## Decisions needed from you

1. **Max video length:** 30 s (config) or 60 s (PRD)? Shorter is faster and safer on 5 GB of VRAM.
2. **Auth in the MVP or deferred?** It's P1 and touches nothing on the critical path. Deferring it saves about half a day.
3. **Training engine:** OK to take whichever of Brush, gsplat, or OpenSplat trains first (2.2), even though the PRD names `gsplat`?

## Fastest order (≈4–5 working days)

| Day | Track A (pipeline) | Track B (app) |
|---|---|---|
| 1 | Phase 0 env + COLMAP spike (2.1) | Phase 1 bug fixes |
| 2 | Trainer decision gate + integrate (2.2–2.3) | Viewer renderer spike on a public sample `.ply` (3) |
| 3 | OOM retry, timing, PLY→splat | Viewer wired to the API, demo scene |
| 4 | Export (4) | Auth (5), or cut it |
| 5 | E2E + polish + README (6) | ← |
