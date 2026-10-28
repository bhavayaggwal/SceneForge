# SceneForge

**Talk to a place.** Open a 3D capture of a room and ask *where is the lamp*, *how many chairs are there*, *how big is the table*, *will a 2.1 m sofa fit between the window and the shelf*. A vision model running on your own machine finds the answer, the camera flies there, and the answer is pinned in 3D.

Everything is local, free and open source: no API keys, no cloud.

```
video ──FFmpeg──▶ frames ──COLMAP──▶ camera poses ──Brush──▶ Gaussian splat (.ply)
                                                                   │
            ┌──────────────── index once ──────────────────────────┘
            ▼
  12 views rendered by Spark ──Qwen3-VL (Ollama)──▶ 2D boxes ──raycast──▶ 3D sightings ──merge──▶ object index
                                                                                                  │
  question ──rules / Qwen3-VL intent──▶ find · count · measure · distance · fit · list ──▶ answer + fly-to + pins
                                                       describe ──▶ Qwen3-VL looks at the current view
```

The model only classifies the question (or describes a view). Every number in an answer comes from the object index and real geometry, so the agent can't invent a measurement.

Full documentation, with the architecture, API, measurements and known limits, is in **[Doc.md](Doc.md)**. To continue development, start from [docs/HANDOFF-2026-10-28.md](docs/HANDOFF-2026-10-28.md).

## Run it

Needs Windows 10/11, Node 24+, [Ollama](https://ollama.com/download) and a GPU with about 4 GB of VRAM (tested on a Quadro P2000, 5 GB).

```powershell
powershell -ExecutionPolicy Bypass -File app\scripts\setup.ps1   # tools, model, samples (about 4.5 GB)
cd app
npm run build
npm start                     # http://127.0.0.1:5180
```

`npm run dev` runs the same app with hot reload on http://localhost:5173.

Setup flags: `-Small` uses the 2B model for GPUs under 4 GB; `-NoTools` skips FFmpeg, COLMAP and Brush (you can still open .ply/.spz/.splat files); `-NoSamples` skips the sample data.

## Using it

1. **Open a place.** The samples appear under Places. Drop a `.ply`, `.spz` or `.splat` onto the viewer, or use **Add capture**.
2. **Reconstruct your own room.** Add capture → *Video of a room*. Walk slowly with the phone and keep things in view from several angles. A 12 s clip takes about 15 min on a P2000 (COLMAP about 3 min, Brush training about 11 min).
3. **Index scene.** The vision model reads 12 views (30–55 s each on a P2000, about 10 min in all, once per place). It keeps going in a background tab and holds the PC awake while it works. Video captures are read from where the real camera stood; other splats from viewpoints circling what you see, so frame the room first. The **Objects** tab shows each object and which views confirmed it.
4. **Set scale.** Splats have no real-world scale. Click both ends of something you know (a door is usually 0.8 m wide) and type its length.
5. **Ask.** Each answer shows the steps the agent took and how long each one took.

Keys: `/` ask · `M` measure · `O` orbit · `H` home view · double-click to fly to a point · `Esc` cancel.

## Use it from any AI agent (MCP)

SceneForge is also an MCP server, so Claude, or any MCP client, can query captured places and drive the viewer:

```powershell
claude mcp add sceneforge -- node C:\path\to\SceneForge\app\server\mcp.ts
```

Tools: `list_scenes`, `get_objects`, `ask`, `fly_to`, `add_pin`, `render_view`, `index_scene`. The app must be running. The tools that move the camera or render need the scene open in a browser tab.

## Stack

| Role | Project | Licence |
|---|---|---|
| Splat rendering, raycasting | [Spark](https://sparkjs.dev) 2.4 on three.js 0.186 | MIT |
| Vision model | [Qwen3-VL-4B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct) via [Ollama](https://ollama.com) | Apache-2.0 / MIT |
| Camera poses | [COLMAP](https://colmap.github.io) 4.2 | BSD |
| Splat training | [Brush](https://github.com/ArthurBrussee/brush) 0.3 | Apache-2.0 |
| Frames | [FFmpeg](https://ffmpeg.org) 8.1 (LGPL build) | LGPL |
| Storage | Node's built-in SQLite | MIT |
| Agent protocol | [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MIT |
| Type | IBM Plex Sans / Mono (bundled) | OFL |

## Sample data

- `data/scenes/room.ply`: the Mip-NeRF 360 *room* scene (Barron et al., CVPR 2022), trained splat from [kishimisu/3d-gaussian-splatting-webgl](https://huggingface.co/kishimisu/3d-gaussian-splatting-webgl). Research data, for testing only.
- `data/videos/pexels-7578552.mp4` and `pexels-17211925.mp4`: interior walkthroughs from Pexels ([7578552](https://www.pexels.com/video/video-of-a-house-interior-7578552/), [17211925](https://www.pexels.com/video/amazing-shot-of-living-room-17211925/)), free to use under the [Pexels licence](https://www.pexels.com/license/). To make the *Dining room* sample, drop `pexels-7578552.mp4` onto the app (Add capture → Video of a room), about 15 min. The second clip is a negative test: it is too bare and glossy to reconstruct, and the app says so.

Data, tools and models stay out of git (`data/`, `tools/`).

## Layout

```
app/
  server/    index.ts (HTTP API + bridge), agent.ts, intent.ts, ollama.ts, pipeline.ts, db.ts, mcp.ts
  shared/    types, label normalisation, sighting merge (used by server, browser and tests)
  src/       viewer.ts (Spark), scan.ts (indexing), main.ts (UI), styles.css
  scripts/   setup.ps1, video-to-splat.ts, export-cameras.ts
  test/      unit tests: npm test
spike/       day-1 feasibility spike (kept for the measurements)
docs/        handoff notes
```

`scene-forge-frontend/` and `scene-forge-backend/` are the earlier video-editing MVP and are superseded by `app/`.
