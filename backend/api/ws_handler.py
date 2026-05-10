import asyncio
import json
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Optional

import cv2
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.detector import PlayerDetector
from core.homography import CourtHomography
from core.shot_classifier import ShotClassifier
from core.tracker import PlayerTracker, BallTracker
from processors.frame_processor import process_frame
from utils.video import encode_frame

# Shared store — REST export endpoints read from here
_session: dict = {"shots": [], "counts": {}}

router = APIRouter()
detector = PlayerDetector()
executor = ThreadPoolExecutor(max_workers=4)


@dataclass
class SessionConfig:
    show_zones:      bool = True
    show_lines:      bool = True
    show_poses:      bool = True
    paused:          bool = False
    frame_count:     int  = 0
    hom:             CourtHomography = field(default_factory=CourtHomography)
    tracker:         PlayerTracker   = field(default_factory=PlayerTracker)
    ball_tracker:    BallTracker     = field(default_factory=BallTracker)
    shot_classifier: ShotClassifier  = field(default_factory=ShotClassifier)


@router.websocket("/ws/video")
async def video_ws(websocket: WebSocket):
    await websocket.accept()
    loop = asyncio.get_event_loop()
    cfg  = SessionConfig()
    cap: Optional[cv2.VideoCapture] = None
    stop_event = asyncio.Event()

    try:
        # Receive start config
        raw_start = await websocket.receive_text()
        start_msg = json.loads(raw_start)

        if start_msg.get("type") != "start":
            await websocket.send_json({"type": "error", "msg": "Expected 'start' message"})
            return

        source       = start_msg.get("source", "")
        calibration  = start_msg.get("calibration")
        court_points = start_msg.get("court_points")
        boundary     = start_msg.get("boundary")
        named_points = start_msg.get("named_points")
        line_bends   = start_msg.get("line_bends")
        cfg.show_zones = start_msg.get("show_zones", True)
        cfg.show_lines = start_msg.get("show_lines", True)
        cfg.show_poses = start_msg.get("show_poses", False)

        if calibration:
            cfg.hom.calibrate(calibration, court_points, boundary, named_points, line_bends)

        # Open video source
        cap = cv2.VideoCapture(source)

        if not cap.isOpened():
            await websocket.send_json({"type": "error", "msg": f"Cannot open: {source}"})
            return

        fps_native  = cap.get(cv2.CAP_PROP_FPS) or 25.0
        frame_delay = 1.0 / min(fps_native, 30)

        # Send first frame for calibration UI
        ret, first = await loop.run_in_executor(executor, cap.read)
        if ret:
            await websocket.send_json({
                "type":              "first_frame",
                "frame":             encode_frame(first),
                "needs_calibration": not cfg.hom.calibrated,
            })

        # Control listener coroutine
        async def listen_controls():
            while not stop_event.is_set():
                try:
                    raw  = await websocket.receive_text()
                    msg  = json.loads(raw)
                    kind = msg.get("type")
                    if kind == "stop":
                        stop_event.set()
                    elif kind == "pause":
                        cfg.paused = True
                    elif kind == "resume":
                        cfg.paused = False
                    elif kind == "calibrate":
                        if pts := msg.get("points"):
                            cfg.hom.calibrate(
                                pts,
                                msg.get("court_points"),
                                msg.get("boundary"),
                                msg.get("named_points"),
                                msg.get("line_bends"),
                            )
                            cfg.tracker = PlayerTracker()
                            cfg.shot_classifier.reset()
                        cfg.show_zones = msg.get("show_zones", cfg.show_zones)
                        cfg.show_lines = msg.get("show_lines", cfg.show_lines)
                        cfg.show_poses = msg.get("show_poses", cfg.show_poses)
                    elif kind == "export_shots":
                        await websocket.send_json({
                            "type":    "shots_export",
                            "shots":   cfg.shot_classifier.shots,
                            "counts":  cfg.shot_classifier.shot_counts(),
                            "by_team": cfg.shot_classifier.team_counts(),
                            "total":   len(cfg.shot_classifier.shots),
                        })
                except WebSocketDisconnect:
                    stop_event.set()
                    break
                except Exception:
                    break

        listener = asyncio.create_task(listen_controls())

        # Frame loop
        try:
            while not stop_event.is_set():
                t0 = time.perf_counter()

                if cfg.paused:
                    await asyncio.sleep(0.05)
                    continue

                ret, frame = await loop.run_in_executor(executor, cap.read)
                if not ret:
                    await websocket.send_json({"type": "end"})
                    break

                try:
                    result = await loop.run_in_executor(executor, process_frame, frame, cfg, detector)
                    result["fps"] = round(1.0 / max(time.perf_counter() - t0, 0.001), 1)
                    _session["shots"]  = cfg.shot_classifier.shots
                    _session["counts"] = cfg.shot_classifier.shot_counts()
                    await websocket.send_json(result)
                except Exception as e:
                    print(f"[ws] frame error: {e}\n{traceback.format_exc()}")
                    await websocket.send_json({"type": "error", "msg": str(e)})

                sleep_t = frame_delay - (time.perf_counter() - t0)
                if sleep_t > 0:
                    await asyncio.sleep(sleep_t)
        finally:
            stop_event.set()
            listener.cancel()

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "msg": str(e)})
        except Exception:
            pass
    finally:
        if cap:
            cap.release()
