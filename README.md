# Padel Game Analyser

Real-time padel player tracking, ball detection, pose estimation, and shot classification using computer vision.

Built with **YOLOv11**, **FastAPI**, **WebSocket**, and **React**.

---

## Demo

> **[Watch the demo video](#)**  ← replace with your actual link

---

## Features

| Feature | Description |
|---|---|
| Player detection | All 4 players tracked via YOLOv11 with two-pass tiled inference |
| Ball tracking | Ball detected per-frame with a 14-point trail |
| Pose estimation | 17-keypoint COCO skeleton drawn live on each player |
| Racket detection | Racket bounding boxes associated with their player |
| Court calibration | Click 4 court corners → homography maps pixels to real metres |
| Court zones | 6 colour-coded zones (service boxes, back courts) |
| Shot classification | Forehand, backhand, smash, lob, volley — from pose + trajectory |
| 2D top-down view | Live animated court map next to the video feed |
| Export | Download shot log as JSON or CSV from the UI |

---

## System Requirements

### Hardware
- **GPU** — NVIDIA GPU with CUDA (tested: RTX 3060 Mobile 6 GB). CPU fallback works but is significantly slower.
- **RAM** — 8 GB minimum, 16 GB recommended.

### Software
| Tool | Version | Notes |
|---|---|---|
| Python | 3.10 or 3.11 | 3.12 works; avoid 3.13 (PyTorch lag) |
| Node.js | 18 LTS or newer | For the React frontend |
| CUDA Toolkit | 11.8 or 12.1 | Only needed for GPU acceleration |

---

## Quick Setup — Windows (PowerShell)

### Step 0 — Allow PowerShell scripts (once per machine)

Windows blocks `.ps1` scripts by default. Open PowerShell **as Administrator** and run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Step 1 — Clone the repository

```powershell
git clone <your-repo-url>
cd padel-game-analyser
```

### Step 2 — Run setup (one time only)

```powershell
.\setup.ps1
```

This script:
1. Creates a Python virtual environment (`venv/`)
2. Installs PyTorch (CUDA 12.1 build on Windows; falls back to CPU)
3. Installs all Python dependencies from `backend/requirements.txt`
4. Downloads YOLO models if not already present
5. Installs frontend Node.js dependencies (`npm install`)

### Step 4 — Start the servers

```powershell
.\start.ps1
```

This opens two PowerShell windows:
- **Backend** → `http://localhost:8000`
- **Frontend** → `http://localhost:5173`

Open `http://localhost:5173` in your browser.

---

## Manual Setup — Linux / macOS

```bash
# 1. Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate

# 2. Install PyTorch (GPU)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
# Or CPU-only:
# pip install torch torchvision

# 3. Install backend dependencies
pip install -r backend/requirements.txt

# 4. Install frontend dependencies
cd frontend && npm install && cd ..

# 5. Place models in backend/
#    backend/yolo11n.pt
#    backend/yolo11n-pose.pt
```

**Start backend:**
```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**Start frontend (separate terminal):**
```bash
cd frontend
npm run dev
```

---

## How to Use

### 1. Load a video

- **Upload:** click the **Upload** button in the toolbar and select a local video file.
- **Path:** type the full absolute path to a video file in the input box (e.g. `C:\Videos\match.mp4`).

### 2. Start processing

Click **Start**. The backend opens the video and streams processed frames through a WebSocket.

### 3. Calibrate the court (first time or when camera changes)

The calibration overlay opens automatically on the first frame if the court has not been calibrated yet. You can also open it manually with the **Calibrate** button.

**In the calibration overlay:**
1. Click the **4 court corners in order**: top-left → top-right → bottom-right → bottom-left.
2. Use the additional line-mark tools to improve accuracy (optional).
3. Click **Apply Calibration**.

After calibration, the video resumes and the system maps every player's foot position to real-world court coordinates (metres).

### 4. Read the analytics panel

The right panel shows:
- Live player positions and their court zone
- Shot statistics per player (with progress bars)
- Recent shot feed (last 8 shots)
- Court zone legend

### 5. Export shot data

Once shots are detected, **Export** buttons appear at the bottom of the analytics panel:
- **⬇ JSON** — full shot log with player/ball court positions
- **⬇ CSV** — flat table, one row per shot

---

## Output Format

### JSON (`/shots.json`)

```json
{
  "shots": [
    {
      "frame": 142,
      "timestamp": 5.68,
      "player_id": "A1",
      "team": "A",
      "shot_type": "forehand",
      "zone": "team1_left_srv",
      "court_pos": [3.2, 8.1],
      "ball_court": [3.5, 7.9]
    }
  ],
  "total": 24,
  "by_player": {
    "A1": { "forehand": 8, "backhand": 3, "smash": 2 }
  }
}
```

### CSV (`/shots.csv`)

| frame | timestamp | player_id | team | shot_type | zone | player_cx | player_cy | ball_cx | ball_cy |
|---|---|---|---|---|---|---|---|---|---|
| 142 | 5.68 | A1 | A | forehand | team1_left_srv | 3.2 | 8.1 | 3.5 | 7.9 |

---

## Project Structure

```
padel-game-analyser/
├── backend/
│   ├── api/
│   │   └── ws_handler.py        # WebSocket endpoint, session lifecycle
│   ├── core/
│   │   ├── detector.py          # YOLOv11 inference wrapper
│   │   ├── homography.py        # Court calibration, zone drawing
│   │   ├── shot_classifier.py   # Hit detection + shot typing
│   │   └── tracker.py           # Player + ball multi-object tracker
│   ├── processors/
│   │   └── frame_processor.py   # Per-frame orchestration pipeline
│   ├── utils/
│   │   └── video.py             # Frame encode helper
│   ├── uploads/                 # Uploaded video files
│   ├── yolo11n.pt               # Detection model (place here)
│   ├── yolo11n-pose.pt          # Pose model (place here)
│   ├── main.py                  # FastAPI app, REST endpoints
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── components/          # Toolbar, AnalyticsPanel, Court2D, CalibrationOverlay
│       ├── hooks/               # useVideoSocket, useCalibration, useDisplaySettings
│       ├── config/              # Constants, zone colours
│       ├── App.jsx
│       └── App.css
├── setup.ps1                    # One-time setup (Windows)
├── start.ps1                    # Launch servers (Windows)
└── README.md
```

---

## Architecture

```
Browser (React)
  │  WebSocket (frames + JSON)
  ▼
FastAPI (ws_handler.py)
  │  ThreadPoolExecutor (non-blocking)
  ▼
frame_processor.py
  ├── YOLOv11 detect  → persons, ball, rackets  (detector.py)
  ├── Tiled inference → far-end players          (2 tiles, batched GPU call)
  ├── Homography      → pixel → court metres     (homography.py)
  ├── Multi-object tracker                       (tracker.py)
  ├── Shot classifier → trajectory reversal      (shot_classifier.py)
  └── OpenCV draw     → zones, boxes, pose, ball
  │
  └── JPEG + base64 → WebSocket → <canvas>
```

### Key design choices

**WebSocket over REST polling** — YOLO inference + encode takes ~30 ms. REST polling would add 100–500 ms round-trip overhead per frame. WebSocket keeps the loop tight.

**Two-pass tiled inference for far-end players** — the court ROI is wider than tall. A top-half-only crop keeps the same width, so the YOLO scale factor doesn't change and distant players stay below the detection threshold. Splitting the far half into left + right tiles (~55 % width each) gives ~3× effective zoom, making 20 px far-end players resolve to ~65 px — reliably detectable.

**Homography calibration** — fisheye cameras distort the court geometry. Four user-selected corner clicks produce an `H` matrix (`cv2.findHomography`) that maps any image pixel to real-world court metres. All zone assignments and shot positions use this coordinate system.

**Trajectory reversal for hit detection** — a ball being hit changes direction. A rolling 12-frame buffer is split at the midpoint; if the dot product of pre-hit and post-hit average velocities is negative (direction reversed) and ball speed exceeds a threshold, a shot event is triggered.

**Shot classification priority** — smash (wrist above shoulder in image-Y) → lob (post-hit ball travels sharply upward) → volley (player inside net zone 7.5–12.5 m) → forehand/backhand (active wrist side vs ball side relative to shoulder midpoint).

---

## Approach / Methodology

### 1. Detection
`YOLOv11n` runs on the full court ROI first (cropped using calibrated corner polygon). A second pass runs two overlapping tiles on the far-court half in a single batched GPU call, zooming ~3× to catch players who are too small at full resolution. Results are merged with IoU-NMS (threshold 0.40).

### 2. Player tracking
A lightweight Hungarian-algorithm tracker assigns persistent IDs across frames using IoU overlap. Players are labelled `A1/A2` (Team A, near side) and `B1/B2` (Team B, far side) based on their court-Y coordinate after calibration.

### 3. Pose estimation
`YOLOv11n-pose` runs on the same tiles (batched), producing 17 COCO keypoints per person. Keypoints drive shot classification and head-false-positive suppression for the ball detector.

### 4. Ball tracking
Ball detections pass through a velocity-aware tracker (`BallTracker`) with a 14-frame trail. Detections within the head region of any tracked player (nose keypoint ± 0.55× player width) are rejected before tracking.

### 5. Shot classification
On each hit event the classifier reads the player's keypoints, ball court position, and post-hit trajectory to assign one of five shot types. All events accumulate in a per-session list exportable as JSON/CSV.

---

## Challenges Faced

| Challenge | Solution |
|---|---|
| Far-end players not detected (too small at full resolution) | Two-tile batched inference giving ~3× zoom on the far half |
| Poles and walls wrongly detected as players | Court boundary filter + aspect-ratio guard (`w/h < 0.22`) |
| Ball confused with player heads | Reject ball candidates within nose-keypoint radius |
| Fisheye camera distortion | Manual 4-corner calibration → homography to real metres |
| Stale WebSocket closure resetting live session state | `statusRef` mirror synced to `status` for use in `onclose` |
| Video playing during calibration | Pause on overlay open, resume on confirm/cancel |
| Far-end player geometry insight | Court ROI is width-dominated → must halve both dims, not just height, for effective zoom |

---

## Improvements to Make

1. **Custom ball model** — train a padel-ball–specific YOLOv11 detector on a labelled dataset to eliminate the head false-positives more robustly than the current keypoint heuristic.
2. **Automatic camera calibration** — detect court lines with a Hough transform and auto-fit the homography, removing the need for manual corner clicks.
3. **Player re-identification** — add appearance embeddings (e.g. BoT-SORT) to survive full occlusions and camera cuts without losing IDs.
4. **Ball 3D trajectory** — estimate ball height from apparent size change; distinguish net-clearance height from lob height for better smash/lob discrimination.
5. **Point-by-point scoring** — detect ball out-of-bounds / wall hits to infer rally and point boundaries automatically.
6. **Heatmaps** — accumulate player court positions over the match and render a per-player coverage heatmap.
7. **Multi-camera support** — stitch feeds from two cameras (one per side) for full court coverage without the zoom-tile workaround.
8. **Performance** — move frame encoding and WebSocket send to an async queue so GPU inference is never blocked by I/O.

---

## API Reference

### WebSocket `ws://localhost:8000/ws/video`

**Start message (client → server)**
```json
{
  "type": "start",
  "source_type": "path",
  "source": "/absolute/path/to/video.mp4",
  "calibration": [[x1,y1],[x2,y2],[x3,y3],[x4,y4]],
  "show_zones": true,
  "show_lines": true,
  "show_poses": true
}
```

**Frame message (server → client)**
```json
{
  "type": "frame",
  "frame": "<base64 JPEG>",
  "players": [
    {
      "id": "A1",
      "bbox": [x1, y1, x2, y2],
      "foot_px": [px, py],
      "court_pos": [cx_m, cy_m],
      "zone": "team1_left_srv",
      "team": "A",
      "confidence": 0.87
    }
  ],
  "ball": { "foot_px": [bx, by], "court_pos": [bcx, bcy] },
  "shot_event": { "player_id": "A1", "shot_type": "forehand", ... },
  "fps": 18.4
}
```

**Control messages (client → server)**
```json
{ "type": "pause" }
{ "type": "resume" }
{ "type": "stop" }
{ "type": "calibrate", "points": [...], "show_zones": true, ... }
```

### REST Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/status` | GPU info, model name |
| POST | `/upload` | Upload video → `{"file_path": "..."}` |
| GET | `/shots.json` | Download full shot log as JSON |
| GET | `/shots.csv` | Download shot log as CSV |

---

## Troubleshooting

**Backend fails to start**
- Make sure you're running from the project root: `.\start.ps1`
- Check Python version: `python --version` (need 3.10+)

**No GPU detected**
```powershell
python -c "import torch; print(torch.cuda.is_available(), torch.version.cuda)"
```
If `False`, reinstall PyTorch with the correct CUDA version for your driver.

**Models not found**
Place `yolo11n.pt` and `yolo11n-pose.pt` directly inside the `backend/` folder. Ultralytics will auto-download them on first run if they are missing (requires internet).

**Players not detected inside court**
- Recalibrate: click the 4 court corners precisely at the boundary lines
- If far-end players are missed, ensure the court ROI includes both ends of the court after calibration

**Black screen / no frames**
- Verify the video path is correct and the file is readable
- Check the backend terminal for error messages
