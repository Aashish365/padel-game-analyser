# Padel Game Analyser — Process Documentation

Internal technical reference. For setup instructions see `README.md`.

---

## Architecture Overview

```
padel-game-analyser/
├── backend/
│   ├── api/
│   │   └── ws_handler.py        # WebSocket lifecycle, session state
│   ├── core/
│   │   ├── detector.py          # YOLOv11 inference (detection + pose)
│   │   ├── homography.py        # Court calibration, coordinate mapping, zone drawing
│   │   ├── shot_classifier.py   # Hit detection + shot type classification
│   │   └── tracker.py           # Player tracker (Hungarian) + ball tracker
│   ├── processors/
│   │   └── frame_processor.py   # Per-frame orchestration pipeline
│   ├── utils/
│   │   └── video.py             # JPEG encode helper
│   ├── uploads/                 # Uploaded video files (runtime)
│   ├── yolo11n.pt               # Detection model weights
│   ├── yolo11n-pose.pt          # Pose estimation model weights
│   ├── main.py                  # FastAPI app entry point
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── components/          # UI components
│       ├── hooks/               # React state hooks
│       ├── config/              # Shared constants
│       ├── App.jsx              # Root component + wiring
│       └── App.css              # Design system (CSS variables)
├── setup.ps1                    # One-time setup (Windows)
├── start.ps1                    # Launch servers (Windows)
└── README.md
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React 18 + Vite | SPA with no routing overhead; Vite cold-start ~300 ms |
| Backend | FastAPI + Uvicorn | Async WebSocket support; minimal overhead vs Django |
| Inference | Ultralytics YOLOv11 | Unified API for detection and pose in one library |
| Video I/O | OpenCV | Robust frame decode + draw primitives |
| Comms | WebSocket | Bidirectional; avoids REST polling latency for live video |
| GPU | PyTorch + CUDA | Single GPU call for batched tile inference |

---

## End-to-End Frame Pipeline

```
VideoCapture.read()
    │
    ▼
frame_processor.process_frame(frame, cfg, detector)
    │
    ├─ 1. Resize to MAX_W=1280 px (preserve aspect ratio)
    │
    ├─ 2. _roi_detect()  ──────────────────────────────────────────────
    │      │  Pass 1: full court ROI crop  →  detector.detect()
    │      │          returns (players, balls, rackets)
    │      │
    │      │  Pass 2: far-court left tile  ┐  batched single GPU call
    │      │          far-court right tile ┘  _detect_pose_batch()
    │      │          results merged with IoU-NMS (thr=0.40)
    │      └─ returns merged (players, balls, rackets) in full-frame coords
    │
    ├─ 3. Draw zones + court lines on working canvas
    │
    ├─ 4. _filter_players_to_court()
    │      aspect ratio guard (w/h < 0.22 → reject pole/wall)
    │      homography px → court metres → in_court() boundary check (margin=0.15 m)
    │      keep top-4 by confidence
    │
    ├─ 5. PlayerTracker.update()  ← Hungarian IoU tracker
    │      assigns stable IDs: A1, A2 (near side), B1, B2 (far side)
    │
    ├─ 6. _associate_rackets()
    │      greedy by confidence, max dist 220 px, one racket per player
    │
    ├─ 7. _reject_head_detections()
    │      any ball candidate within 0.55× player-width of nose keypoint → dropped
    │
    ├─ 8. _filter_balls_to_court()
    │      homography px → court metres → in_court() boundary check (margin=2.0 m)
    │
    ├─ 9. BallTracker.update()
    │      velocity-aware, 14-frame trail, max jump 500 px, max gap 10 frames
    │
    ├─ 10. ShotClassifier.update()
    │       trajectory reversal detection → classify shot type
    │       returns shot_event dict or None
    │
    ├─ 11. OpenCV draw: player boxes, IDs, foot dots, pose skeleton, racket boxes,
    │                   ball circle + trail, shot label flash
    │
    └─ 12. encode_frame()  →  JPEG quality=78, resize if > 1280 px → base64
               │
               └── WebSocket send → React <canvas>
```

---

## Detection: Two-Pass Tiled Inference

### Why tiling is necessary

The court ROI is typically ~700 × 450 px. At `imgsz=1280`:

| Image | Width | YOLO scale | 20 px player → |
|---|---|---|---|
| Full ROI | 700 px | 1280/700 = 1.83× | ~37 px (borderline) |
| Half-width tile | 350 px | 1280/350 = 3.66× | ~73 px (reliable) |

A top-half-only crop keeps the full width → same scale factor → no improvement.
Splitting horizontally into left + right tiles (~55 % width, overlapping) halves the effective width, tripling the scale.

### Implementation (`frame_processor._roi_detect`)

```
Pass 1  full ROI          →  persons + balls + rackets  (conf 0.25 / 0.12 / 0.18)
Pass 2  tile_l (far left) ┐
        tile_r (far right)┘  batched GPU call  →  persons only  (pose model)
NMS merge: iou_thr=0.40
```

Both tiles are fed to `detector._detect_pose_batch([tile_l, tile_r])` in a single Ultralytics forward pass — one GPU kernel launch instead of two.

---

## Court Calibration & Homography

### Calibration flow

1. User opens the CalibrationOverlay (auto-opens on first uncalibrated frame; video is paused while the overlay is active).
2. User clicks the 4 court corners: top-left → top-right → bottom-right → bottom-left.
3. Optional: additional named key-points (net endpoints, service-line endpoints) for higher-accuracy zone drawing.
4. `CourtHomography.calibrate(image_pts, court_pts, ...)` calls `cv2.findHomography(src, dst)` to produce matrix `H`.

### Coordinate system

```
(0, 0) ────────────────── (10, 0)          ← top wall
  │        Team A side         │
  │   service line: y = 3.05   │
  │                            │
(0,10) ═══════ NET ═══════ (10,10)         ← y = 10 m
  │                            │
  │   service line: y = 16.95  │
  │        Team B side         │
(0,20) ────────────────── (10,20)          ← bottom wall
```

Units: metres. Court is 10 m wide × 20 m long.

### Pixel → court mapping

```python
# forward (pixel → court metres)
pt_m = cv2.perspectiveTransform([[px, py]], H)

# used for:
#   - player zone assignment
#   - in-court boundary filter
#   - shot classifier court_pos field
#   - 2D view rendering
```

### Zone definitions

| Zone name | x range (m) | y range (m) |
|---|---|---|
| team1_back | 0–10 | 0–3.05 |
| team1_left_srv | 0–5 | 3.05–10 |
| team1_right_srv | 5–10 | 3.05–10 |
| team2_left_srv | 0–5 | 10–16.95 |
| team2_right_srv | 5–10 | 10–16.95 |
| team2_back | 0–10 | 16.95–20 |

---

## Player Tracking

`PlayerTracker` (core/tracker.py) is a lightweight IoU-based multi-object tracker:

1. **Match** existing tracks to new detections via greedy IoU (threshold 0.30).
2. **Age** unmatched tracks; remove after `max_age=10` frames.
3. **Create** new tracks for unmatched detections.
4. **ID assignment** — on first appearance, each track's court-Y position determines team:
   - `court_y < 10` → Team A (IDs: A1, A2)
   - `court_y ≥ 10` → Team B (IDs: B1, B2)

`BallTracker` uses velocity-gating (max jump 500 px/frame) and temporal interpolation (gap ≤ 10 frames) to maintain a smooth trajectory through brief occlusions.

---

## Shot Classification

### Hit detection

A rolling deque of 12 ball positions is maintained. On each frame:

1. Split the buffer at midpoint → `buf_pre`, `buf_post`.
2. Compute average pixel velocity for each half:  `v_pre`, `v_post`.
3. **Hit condition:** `dot(v_pre, v_post) < 0` (direction reversed) AND `speed_pre > 4 px/frame` OR `speed_post > 4 px/frame`.
4. A cooldown of 18 frames prevents re-triggering on the same event.

### Nearest player association

The player closest to the ball's position (foot point OR upper-quarter striking zone) within 170 px is assigned as the hitter.

### Shot type priority

```
1. Smash    — wrist keypoint clearly above shoulder keypoint (> 15 px in image-Y),
              OR ball was dropping fast pre-hit (v_pre_y > 8 px/frame)

2. Lob      — post-hit ball travels strongly upward (v_post_y < −7 px/frame,
              vertical component > 70 % of total)

3. Volley   — player's court_y is inside net zone (7.5 m < y < 12.5 m)

4. Forehand — active wrist is on the SAME side as the ball relative to
              the shoulder midpoint (body centre)

5. Backhand — active wrist crosses to the OPPOSITE side
```

"Active wrist" is whichever wrist (left or right, confidence > 0.3) is closer to the ball.

### Output record

```python
{
    "frame":      int,          # frame index in video
    "timestamp":  float,        # seconds since epoch
    "player_id":  str,          # e.g. "A1"
    "team":       str,          # "A" or "B"
    "shot_type":  str,          # forehand | backhand | smash | lob | volley
    "zone":       str,          # court zone name
    "court_pos":  [float, float],   # player foot in metres
    "ball_court": [float, float],   # ball in metres
}
```

---

## WebSocket Session Lifecycle

```
Client                          Server
  │── start ──────────────────► ws_handler
  │                              │  open VideoCapture
  │                              │  send first_frame (for calibration UI)
  │◄── first_frame ─────────────│
  │                              │  loop:
  │◄── frame × N ───────────────│    process_frame → send result
  │── calibrate ────────────────►│    update HomographyMatrix in-place
  │── pause / resume ───────────►│    toggle cfg.paused flag
  │── stop ────────────────────►│  release VideoCapture
  │◄── end ──────────────────── │
```

`SessionConfig` (dataclass in ws_handler.py) holds all per-session state:

| Field | Type | Purpose |
|---|---|---|
| `hom` | CourtHomography | Homography matrix + zone geometry |
| `tracker` | PlayerTracker | Active player tracks |
| `ball_tracker` | BallTracker | Ball trajectory state |
| `shot_classifier` | ShotClassifier | Hit buffer + shot log |
| `show_zones` | bool | Zone overlay toggle |
| `show_lines` | bool | Court lines overlay toggle |
| `show_poses` | bool | Skeleton overlay toggle |
| `paused` | bool | Pause flag read by frame loop |
| `frame_count` | int | Monotonic frame index |

---

## REST Endpoints

| Method | Path | Handler | Notes |
|---|---|---|---|
| GET | `/status` | `main.py` | GPU name, model name |
| POST | `/upload` | `main.py` | Saves to `backend/uploads/`, returns path |
| GET | `/shots.json` | `main.py` | Reads `_session["shots"]` from ws_handler |
| GET | `/shots.csv` | `main.py` | Flattened CSV, one row per shot |

`_session` is a module-level dict in `ws_handler.py` updated every frame. The REST endpoints read it directly without locking — safe because Python's GIL serialises the dict update.

---

## Frontend State Management

All frontend state lives in custom hooks, not global stores:

| Hook | Manages |
|---|---|
| `useVideoSocket` | WebSocket connection, frame stream, player/ball/shot state |
| `useCalibration` | Calibration points, calibration overlay open/close, pause-on-open |
| `useDisplaySettings` | Toggle states (zones, lines, poses, 2D view) |
| `useVideoSource` | Source input string, local file upload path |

`App.jsx` wires the hooks together and passes props down to leaf components. No context or external state library is used.

### Calibration pause/resume

When the calibration overlay opens (either explicitly via the Calibrate button, or automatically on the first uncalibrated frame), the frontend sends `{ type: "pause" }` over the WebSocket and records whether the video was already paused before. On overlay close (confirm or cancel), if the video was playing before it sends `{ type: "resume" }`.

---

## Model Configuration

`core/detector.py` searches for models in this order:

```
backend/yolo11m-pose.pt   ← preferred (medium, more accurate)
backend/yolo11n-pose.pt   ← fallback (nano, faster)
backend/yolo11m.pt        ← preferred for detection
backend/yolo11n.pt        ← fallback for detection
```

If no file is found, Ultralytics auto-downloads the nano variant (`yolo11n-pose.pt` / `yolo11n.pt`) from its CDN on first run.

YOLO inference settings:

| Setting | Detection | Pose |
|---|---|---|
| imgsz | 960 | 1280 |
| conf (person) | 0.25 | 0.10 |
| conf (ball) | 0.12 | — |
| conf (racket) | 0.18 | — |
| device | CUDA 0 or CPU | same |

---

## Known Limitations

- **Single camera** — the tiled-inference workaround compensates for one wide-angle camera, but a second camera covering the far end would be cleaner.
- **Ball model** — using the general COCO sports-ball class (index 32) rather than a padel-ball–specific model. Head false-positives are suppressed via keypoints but not eliminated at very low confidence thresholds.
- **Shot classification** — relies on COCO pose accuracy; if pose estimation fails (player partially occluded), the shot defaults to "forehand".
- **No temporal smoothing on zone** — zone label can flicker on frame boundaries near zone edges. A majority-vote over the last N frames would smooth this.
