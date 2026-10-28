# SceneForge: project documentation

**Talk to a place.** Open a 3D capture of a room and ask *where is the lamp*, *how many chairs are there*, *how big is the table*, *will a 2.1 m sofa fit between the window and the shelf*. A vision model running on your own machine finds the answer; the camera flies there and the answer is pinned in 3D. Any AI agent can do the same through MCP.

Local, free and open source: no API keys, no cloud.

State as of 2026-10-28: built, end-to-end tested on the target machine, **not yet committed**. To pick up the work, read `docs/HANDOFF-2026-10-28.md`.

---

## Contents

1. [Why this project](#1-why-this-project)
2. [How it works](#2-how-it-works)
3. [Running it](#3-running-it)
4. [Using it](#4-using-it)
5. [MCP server](#5-mcp-server)
6. [Code map](#6-code-map)
7. [HTTP API](#7-http-api)
8. [Data and storage](#8-data-and-storage)
9. [Configuration](#9-configuration)
10. [UI design](#10-ui-design)
11. [Measured results](#11-measured-results)
12. [Hard-won lessons](#12-hard-won-lessons)
13. [Known limits](#13-known-limits)
14. [Stack, licences, sample data](#14-stack-licences-sample-data)
15. [History](#15-history)

---

## 1. Why this project

The original SceneForge (`scene-forge-frontend/`, `scene-forge-backend/`) was a phone-video → Gaussian-splat → edit → export MVP. By October 2026 every step of that is a commodity (Polycam, Scaniverse, SuperSplat, the three.js splat renderer, World Labs Marble). The gap that remains is an AI that can **see, navigate and reason inside a real 3D capture**: that exists only in research papers (SplatTalk, GaussExplorer, LEGS, Dr. Splat), and no product or MCP server offers it.

The goal is a portfolio project that is unique and could scale. The constraints:

- runs locally on a Quadro P2000 (5 GB VRAM, Pascal), i7-9700, 16 GB RAM;
- zero budget;
- strictly open source.

## 2. How it works

```
video ──FFmpeg──▶ frames ──COLMAP──▶ camera poses ──Brush──▶ Gaussian splat (.ply) + camera path
                                                                   │
            ┌──────────────── index once ──────────────────────────┘
            ▼
  12 views rendered by Spark ──Qwen3-VL (Ollama)──▶ 2D boxes ──raycast──▶ 3D sightings ──merge──▶ object index
                                                                                                  │
  question ──rules / Qwen3-VL intent──▶ find · count · measure · distance · fit · list ──▶ answer + fly-to + pins
                                                       describe ──▶ Qwen3-VL looks at a scan view
```

**Index once, answer many.** A small local model is too slow to look at the scene for every question, so the work is split:

1. **Scan.** The browser renders 12 views. For a video scene they come from evenly spaced *real capture cameras*, where the splat is sharpest. For a splat without cameras they orbit the target of the current view across ±75° at two distances, so the user frames the room first.
2. **Detect.** Each view goes to Qwen3-VL-4B-Instruct, which returns boxes in its native compact format (`[{"bbox_2d":[x1,y1,x2,y2],"label":"…"}]`, 0–1000 normalised).
3. **Locate.** For each box the viewer raycasts 5 points into the splat and keeps the median-depth hit. Its apparent width and height are worked out from the box's angular size at that depth.
4. **Merge.** Sightings with the same canonical label (sofa = couch, tv = television…) closer than half the larger extent become one object, using median positions. Two boxes in one view are always two objects. With 8 or more views, objects seen only once are dropped.
5. **Answer.** Rules parse common phrasings instantly; the model, constrained by a JSON schema, classifies the rest. Code answers from the index and real geometry, then flies the camera and pins the result. Only "describe" questions use the model's words, and then it looks at the scan view that saw the named object.
6. **Scale.** Splats have no real-world scale. The user clicks both ends of something of known length; `metersPerUnit` is stored per scene.

## 3. Running it

Windows 10/11, Node 24+, [Ollama](https://ollama.com/download), a GPU with about 4 GB VRAM.

```powershell
powershell -ExecutionPolicy Bypass -File app\scripts\setup.ps1   # npm install, tools, model, samples (~4.5 GB); safe to re-run
cd app
npm run build
npm start                     # http://127.0.0.1:5180
```

| Command (in `app/`) | What it does |
|---|---|
| `npm run dev` | API on :5180 plus Vite with hot reload on http://localhost:5173. Saving a client file reloads the page, which kills a running scan. |
| `npm run build` / `npm start` | Production build, served by the API server on :5180 |
| `npm test` | Unit tests (`node --test`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run mcp` | The MCP server on stdio |
| `node scripts/video-to-splat.ts <video> <workDir> [steps] [fps]` | The pipeline from the command line |
| `node scripts/ask.ts <scene-id> "question" …` | Ask the running app and print answers with traces |
| `node scripts/mcp-smoke.ts ["question"]` | Connect over MCP like an agent and exercise the tools |
| `node scripts/export-cameras.ts <images.txt> <out.cameras.json>` | Camera path for a splat trained outside the app |

Setup flags: `-Small` (2B model; see §12 before using it), `-NoTools` (no FFmpeg, COLMAP or Brush; .ply/.spz/.splat still open), `-NoSamples`.

## 4. Using it

1. **Open a place.** Samples appear under Places. Drop a `.ply`, `.spz`, `.splat` or `.ksplat` on the viewer, or use **Add capture**.
2. **Reconstruct a room.** Add capture → *Video of a room*. Walk slowly, keep textured things in view, and move sideways as well as forward. A 12 s clip takes about 15 min on the P2000. A video COLMAP can't place (fewer than 30% of frames, or under 10) fails with filming advice instead of producing a scrap.
3. **Index scene.** About 10 min for 12 views, once per place. It keeps running in a background tab and holds the PC awake. **Stop** keeps the old index. Opening another place stops the scan.
4. **Set scale.** Click both ends of something of known length and type it in metres. Sizes switch from units to cm and m.
5. **Ask.** Each answer shows the agent's steps (tool, detail, time). A new answer's pins replace the previous answer's.
6. **Objects tab:** every object with a strip showing which scan views confirmed it, and its width. Click a row to fly to it. **Pins tab:** fly to or remove pins.

Keys: `/` ask · `M` measure · `O` orbit · `H` home view · double-click to fly to a point · `Esc` cancel.

Question types (rules first, model fallback):

| Intent | Example | Answer built from |
|---|---|---|
| find | Where is the lamp? | Best-confirmed match, nearest neighbour and its distance; fly-to and pin |
| count | How many chairs are there? / Is there a plant? | Matches, including kinds: "chairs" includes armchairs; camera frames them all and pins each |
| measure | How big is the dining table? | Index width and height |
| distance | How far is the plant from the table? | Closest pair, centre to centre |
| fit | Will a 2.1 m sofa fit between the lamp and the plant? | Gap minus half of each object's width. Needs the scale; otherwise enters calibrate mode |
| list | What is in this room? | Counts per label |
| describe | What colour are the chairs? | Qwen3-VL on the scan view that saw the named object, or on the current view |

## 5. MCP server

```powershell
claude mcp add sceneforge -- node C:\path\to\SceneForge\app\server\mcp.ts
```

The app must be running (`SF_URL`, default `http://127.0.0.1:5180`). The tools that move the camera or render need the scene open in a browser tab; the bridge sends them there.

| Tool | Tested | Notes |
|---|---|---|
| `list_scenes` | yes | id, name, objects, indexed, metersPerUnit |
| `get_objects` | yes | Index plus scale; optional label filter |
| `ask` | yes | Answer and trace; appears live in the open conversation and moves the camera |
| `render_view` | yes | JPEG of the open viewer |
| `fly_to` | via `ask` only | Moves the open viewer |
| `add_pin` | no (the HTTP route works) | Pins added this way survive new answers |
| `index_scene` | **no** | Starts a scan in the open viewer and waits up to 1 h |

## 6. Code map

```
app/
  index.html            shell markup (sidebar, top bar, sheet: stage + panel)
  vite.config.ts        dev proxy /api → :5180
  server/
    index.ts            HTTP server + routes; serves dist/; seeds samples from data/scenes/
    agent.ts            ask(): intents → index queries → answer, commands, pins, trace
    intent.ts           rule parser + model fallback (JSON schema)
    ollama.ts           streaming chat, detect(), describe(), parseBoxes(), model selection
    pipeline.ts         videoToSplat(): FFmpeg → COLMAP → Brush; parseColmapImages()
    bridge.ts           SSE to viewers; request/response for render_view and scan
    db.ts               node:sqlite schema and queries
    views.ts            saved scan views per scene
    keepawake.ts        Windows SetThreadExecutionState helper
    tools.ts            finds ffmpeg/colmap/brush; COLMAP env (PATH, QT_PLUGIN_PATH)
    paths.ts            data directories
    mcp.ts              MCP stdio server
    dev.ts              dev launcher (API + Vite)
  shared/
    types.ts            Scene, SceneObject, Sighting, Pin, Message, Job, ViewerCommand
    labels.ts           canonical(), matches(), plural(); synonyms and kinds
    merge.ts            mergeSightings()
  src/
    main.ts             UI state, rendering, events, asking, scanning, measuring, uploads
    viewer.ts           Spark/three viewer: on-demand render, fly-to, frame, pins, measure, capture
    scan.ts             capturePoses(), anchorPoses(), scan()
    api.ts              fetch, upload with progress, NDJSON stream
    styles.css          design tokens and layout
  scripts/              setup.ps1, video-to-splat.ts, ask.ts, mcp-smoke.ts, export-cameras.ts
  test/                 core.test.ts, keepawake.test.ts
spike/                  day-1 feasibility spike (viewer.html, vlm-bbox.mjs); kept for its numbers
docs/                   handoffs
```

## 7. HTTP API

All routes are under `http://127.0.0.1:5180`. Errors come back as `{ "error": "…" }` with a status code.

| Method and path | Purpose |
|---|---|
| `GET /api/health` | Ollama status and model; which tools are found |
| `GET /api/scenes` · `POST /api/scenes` | List; upload a splat (raw body, `x-filename` header, streamed to disk, max 4 GB) |
| `GET / PATCH / DELETE /api/scenes/:id` | Read; patch `name`, `metersPerUnit`, `view`, `flip`, `splats`; delete (sample files are kept) |
| `GET /api/scenes/:id/file.<ext>` | The splat file |
| `GET / PUT /api/scenes/:id/thumb` | Place thumbnail |
| `GET / PUT /api/scenes/:id/objects` | Index; PUT `{sightings, scanViews}` merges and replaces it (and clears pins) |
| `POST /api/detect` | `{image, sceneId?, view?}` → boxes. Saves the scan view; 3 min timeout; cancelled if the client disconnects |
| `GET / POST / DELETE /api/scenes/:id/pins`, `DELETE …/pins/:pin` | Pins |
| `GET / DELETE /api/scenes/:id/messages` | Conversation |
| `POST /api/scenes/:id/ask` | `{question, view?, fromViewer?}` → NDJSON: `step`… then `answer` or `error` |
| `POST /api/scenes/:id/command` | Drive the open viewer: `fly_to`, `frame`, `render_view` (returns an image), `scan` (waits) |
| `GET /api/events?scene=` | SSE: `scenes`, `scene`, `job`, `command`, `request` |
| `POST /api/bridge/:id` | Viewer's reply to a `request` |
| `GET /api/jobs` · `POST /api/videos?steps=7000` | Jobs; upload a video to reconstruct (`x-filename`; steps 1,000–30,000) |

## 8. Data and storage

Nothing below is in git (`data/`, `tools/`, `app/node_modules`, `app/dist`, `spike/out` are ignored).

```
data/
  scenes/                 samples, registered at server start
    room.ply              Mip-NeRF 360 room (270 MB, 1.09 M splats)
    dining-room.ply       reconstructed from pexels-7578552 (11.7 MB, 51,820 splats)
    dining-room.cameras.json   its 98 capture cameras
  videos/                 Pexels test clips
  sceneforge/
    sceneforge.db         SQLite: scenes, objects, pins, messages, jobs
    scenes/               uploaded and reconstructed splats
    jobs/<id>/            upload + work/ (images, database.db, sparse, dense, poses, train, scene.ply, cameras.json, result.json)
    views/<scene>.jpg     thumbnails;  views/<scene>/<i>.jpg  scan views
    brush-rate.json       measured Brush steps per second (drives training progress)
tools/                    ffmpeg/, colmap/, brush/ (from setup.ps1)
```

Current database: **Dining room** (`dining-room-9407`): 24 objects, scale 0.362 m/unit, set on the table at an assumed 2.4 m. **Living room** (`room-1310`): 11 objects, scale not set. Two failed test jobs.

## 9. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SF_PORT` | 5180 | Server port |
| `SF_DATA` / `SF_DB` | `data/sceneforge` / `<data>/sceneforge.db` | Storage locations |
| `SF_VLM` / `SF_VLM_FALLBACK` | `qwen3-vl:4b-instruct` / `qwen3-vl:2b-instruct` | Vision models |
| `SF_NUM_GPU` | unset | Force layers onto the GPU, e.g. `99`. Off by default; see §12 |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama |
| `SF_FFMPEG`, `SF_FFPROBE`, `SF_COLMAP`, `SF_BRUSH` | `tools/…` then PATH | Tool overrides |
| `SF_URL` | `http://127.0.0.1:5180` | Where the MCP server finds the app |

Model calls use `think:false`, temperature 0, `num_ctx` 4096 and `keep_alive` 15 m. Detection allows up to 15 objects and 520 tokens; images are 768 px on the long side.

## 10. UI design

Built with the **Taste Skill** (`design-taste-frontend`, installed in `.agents/skills/`, linked in `.claude/skills/`), following its app-screen run.

- **Style:** `framed-sheet`, seed 1757961471, no redraws. A tinted L-frame (228 px sidebar, 48 px top bar, no rule between them) holds a white sheet inset 8 px with 16 px corners and no shadow. Inside: the 3D stage and a 392 px panel (Ask, Objects, Pins tabs with a 2 px ink underline).
- **The screen's question:** where in this place is the thing I asked about, and how big or how many?
- **Face:** surveyor's flagging-tape pink `#d1246b` is the only data hue: pins, the measure line, the selected object. The chrome is neutral, and the product mark is a pink survey flag.
- **Product-specific element:** a sightings strip per object (one cell per scan view), which shows confidence honestly.
- **Type:** IBM Plex Sans (bundled through @fontsource, so it works offline); IBM Plex Mono only for tool names in the trace.
- **Responsive:** below 1100 px the sidebar becomes a drawer. Below 760 px the sheet fills the screen and the panel scrolls with the ask box pinned in reach.
- **Gate:** `lint.mjs --app` gives 0 FAIL / 0 WARN, and `inspect.mjs --app` on the production build gives 0 FAIL / 0 WARN at 1440, 768 and 390 px. Intentional exceptions, marked `taste-skill-ignore` in `styles.css`: monospace for trace tool names (code), and shadows only on floating things (menu, toast, phone drawer).

## 11. Measured results

Quadro P2000 5 GB, i7-9700, 16 GB RAM.

| Area | Result |
|---|---|
| Spark load of the 1.09 M-splat room | 2.3 s; about 12 fps at 1568×726; idle costs nothing (on-demand rendering) |
| Raycast | 170 ms per ray at 1 M splats; 7 ms at 52 k |
| Detection, `qwen3-vl:4b-instruct` | 28–55 s per view with the viewer open (Ollama keeps ~30% on the CPU); about 10 min per 12-view scan |
| Video → splat, 12 s clip, 98 frames at 1280 px | 14.3 min: FFmpeg 1 s, SIFT 33 s, matching 66 s, mapping 71 s (98 of 98 posed), Brush 7,000 steps 11.4 min |
| Dining room index (capture-camera views) | 24 objects: 6 vases, 6 chairs, 5 lamps, 3 tables, 3 plants, rug. Table seen in 12 of 12 views |
| Living room index (anchored views) | 11 objects. A guessed ring of cameras found 1. TV and speakers missed |
| Find / count / measure / distance / fit / list | Under 50 ms each |
| Scale on the table (assumed 2.4 m) | Dining chairs 46–55 cm wide, rug 2.51 m: plausible |
| Describe: "What colour are the chairs?" | "White with light wood or metal frames" (correct), 8 s |
| Video job, second Pexels clip | Refused correctly: 2 of 48 frames posed |
| Scene switched mid-scan | Scan stops; old index kept |
| Tests | 9 of 9 pass; typecheck clean |

## 12. Hard-won lessons

Each of these cost time and is now handled in code.

- **`qwen3-vl:4b` is the thinking variant.** It ignores `think:false` and produces about 2,400 hidden tokens per view (197 s). Use `qwen3-vl:4b-instruct`.
- **`qwen3-vl:2b-instruct` is unusable for detection:** it labels everything "furniture" and loops.
- **Schema-constrained JSON (`format`)** produced about 6× more tokens than Qwen's native grounding format. It's used only for intent.
- **Forcing `num_gpu: 99`** fits next to Chrome for one view but starved WebGL during a scan and froze the tab. It's now opt-in.
- **Spark 2.x needs an explicit `SparkRenderer`** in the scene, or nothing draws. 3DGS/COLMAP PLYs are y-down: the viewer flips them 180° about X.
- **COLMAP on Windows exits with 0xC0000409** unless `QT_PLUGIN_PATH` points at its `plugins/`; SiftGPU opens an OpenGL context even in the no-CUDA build.
- **Brush prints no progress when not attached to a terminal.** Progress is estimated from the measured steps per second.
- **Brush keeps COLMAP's coordinate frame**, so capture cameras can drive the scan, fly-to, framing and the start view. Away from the capture path, a 7,000-step splat is blur.
- **The PC sleeps when idle** and suspended scans twice. The keep-awake helper first failed silently: in Windows PowerShell `0x80000001` is a negative Int32. Now `[Convert]::ToUInt32('80000001', 16)`, with a test.
- **Chrome stops `requestAnimationFrame` in hidden tabs** and throttles timers to once a minute. Scan captures render directly and wait on Spark's sort callback plus a Web Worker timer.
- **A scene switch mid-scan** filed one room's objects under another. Scans now check `viewer.loadedUrl` before every view.
- **The server didn't cancel Ollama** when the browser aborted a request. Detection now aborts on client disconnect.
- **The Hugging Face CDN stalls mid-download.** Downloads use curl with a stall timeout and resume.
- **Browser-tool tab titles lag** behind the page; don't read them as app state.

## 13. Known limits

- The 4B model misses small or dark objects and merges neighbours: 6 dining chairs came back as 4 dining chairs plus 2 lounge chairs, all labelled "armchair".
- Sizes come from 2D boxes and are estimates; the Measure tool is exact. Depth isn't estimated.
- Splats without capture cameras depend on the user framing the room before indexing.
- About 10 min per index on a P2000; the scan can't resume after a crash.
- No UI to save a custom home view (`PATCH view` exists in the API).
- Failed jobs stay listed in the sidebar for 10 minutes, with no dismiss button.
- Windows only for setup and keep-awake; the code is otherwise portable.

## 14. Stack, licences, sample data

| Role | Project | Licence |
|---|---|---|
| Splat rendering, raycasting | Spark 2.4.0 on three.js 0.186.1 | MIT |
| Vision model | Qwen3-VL-4B-Instruct via Ollama | Apache-2.0 / MIT |
| Camera poses | COLMAP 4.2.1 (no CUDA) | BSD |
| Splat training | Brush 0.3.0 | Apache-2.0 |
| Frames | FFmpeg 8.1 (LGPL build) | LGPL |
| Storage | Node built-in SQLite | MIT |
| Agent protocol | MCP TypeScript SDK 1.32 | MIT |
| Build | Vite 8, TypeScript 5.9 | MIT / Apache-2.0 |
| Type | IBM Plex Sans / Mono via @fontsource | OFL |

Sample data:

- *Living room*: Mip-NeRF 360 `room` (Barron et al., CVPR 2022), trained splat from `kishimisu/3d-gaussian-splatting-webgl` on Hugging Face. Research data, for testing only.
- Pexels clips 7578552 ("video of a house interior") and 17211925 ("amazing shot of living room"), under the Pexels licence. The first produced the *Dining room*; the second is the negative test.

## 15. History

- **Before 2026-10-24:** video-editing MVP with a FastAPI pipeline and Next.js frontend, mostly mocked (see `EXECUTION_CHECKLIST.md`). Superseded.
- **2026-10-24:** audit, market research, pivot to "talk to a place". `docs/HANDOFF-2026-10-24.md`.
- **2026-10-28:** day-1 spike passed; full app built in `app/` and tested end to end; this document; `docs/HANDOFF-2026-10-28.md`.
