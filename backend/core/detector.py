import os
import cv2
import numpy as np
import torch
from ultralytics import YOLO
from pathlib import Path

if torch.cuda.is_available():
    _DEVICE = 0
    print(f"[detector] GPU: {torch.cuda.get_device_name(0)}")
else:
    _DEVICE = "cpu"
    _n = os.cpu_count() or 4
    torch.set_num_threads(_n)
    torch.set_num_interop_threads(max(1, _n // 2))
    if not torch.version.cuda:
        print("[detector] WARNING: PyTorch has no CUDA build — re-run setup.ps1 with GPU drivers installed.")
    else:
        print("[detector] WARNING: CUDA build present but no GPU visible — check driver/CUDA installation.")
    print(f"[detector] CPU mode — {_n} threads")

# Ultralytics auto-downloads any missing .pt on first run.
_BACKEND = Path(__file__).parent.parent
_SEARCH_POSE = [
    _BACKEND / "yolo11m-pose.pt",
    _BACKEND / "yolo11n-pose.pt",
]
_SEARCH_DET = [
    _BACKEND / "yolo11m.pt",
    _BACKEND / "yolo11n.pt",
]


def _find(paths: list, fallback: str) -> str:
    for p in paths:
        if p.exists():
            return str(p)
    return fallback


class PlayerDetector:
    """
    Two-model design:
      • det_model  (yolo11m)      — person + ball + racket in one pass
      • pose_model (yolo11m-pose) — person + 17-keypoint skeleton

    detect(run_pose=False) → 1 inference call (det_model only).
    detect(run_pose=True)  → 2 calls (pose for players, det for ball+racket).

    Returns (players, balls, rackets) — three separate lists.
    """

    def __init__(self):
        det_path  = _find(_SEARCH_DET,  "yolo11m.pt")
        pose_path = _find(_SEARCH_POSE, "yolo11m-pose.pt")

        self.det_model  = YOLO(det_path);  self.det_model.fuse()
        self.pose_model = YOLO(pose_path); self.pose_model.fuse()

        print(f"[detector] device={_DEVICE}")
        print(f"[detector] det   → {self.det_model.ckpt_path}")
        print(f"[detector] pose  → {self.pose_model.ckpt_path}")

    # ── Public ────────────────────────────────────────────────────────────

    def detect(self, frame: np.ndarray, run_pose: bool = False):
        """Returns (players, balls, rackets)."""
        if run_pose:
            players = self._detect_pose(frame)
            balls, rackets = self._detect_balls_and_rackets(frame)
        else:
            players, balls, rackets = self._detect_combined(frame)
        return players, balls, rackets

    # ── Internals ─────────────────────────────────────────────────────────

    def _detect_combined(self, frame: np.ndarray):
        """Single pass: person (0) + ball (32) + racket (38)."""
        results = self.det_model(
            frame,
            classes=[0, 32, 38],
            conf=0.12,
            iou=0.45,
            max_det=24,
            imgsz=960,
            verbose=False,
            device=_DEVICE,
        )
        players, balls, rackets = [], [], []
        for r in results:
            if r.boxes is None:
                continue
            for box in r.boxes:
                cls  = int(box.cls[0])
                conf = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().tolist()
                if cls == 0 and conf >= 0.25:
                    players.append({
                        "bbox":      [x1, y1, x2, y2],
                        "foot_px":   [(x1+x2)/2.0, float(y2)],
                        "confidence": conf,
                        "keypoints": None,
                    })
                elif cls == 32 and conf >= 0.12:
                    balls.append({
                        "bbox":      [x1, y1, x2, y2],
                        "foot_px":   [(x1+x2)/2.0, (y1+y2)/2.0],
                        "confidence": conf,
                    })
                elif cls == 38 and conf >= 0.18:
                    rackets.append({
                        "bbox":      [x1, y1, x2, y2],
                        "foot_px":   [(x1+x2)/2.0, (y1+y2)/2.0],
                        "confidence": conf,
                    })
        return players, balls, rackets

    def _detect_pose(self, frame: np.ndarray):
        """Pose model — persons with 17-keypoint skeleton."""
        return self._run_pose([frame])[0]

    def _detect_pose_batch(self, frames: list) -> list:
        """
        Batch pose inference on multiple tiles in ONE GPU call.
        Returns list[list[player]] — one inner list per input frame.
        """
        return self._run_pose(frames)

    def _run_pose(self, frames: list) -> list:
        """Shared pose inference kernel."""
        results = self.pose_model(
            frames,
            classes=[0],
            conf=0.10,
            iou=0.45,
            max_det=8,
            imgsz=1280,
            verbose=False,
            device=_DEVICE,
        )
        out = []
        for r in results:
            players = []
            if r.boxes is not None:
                kp_data = r.keypoints
                for i, box in enumerate(r.boxes):
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().tolist()
                    kpts = None
                    if kp_data is not None and i < len(kp_data):
                        kpts = kp_data[i].data[0].cpu().numpy().tolist()
                    players.append({
                        "bbox":       [x1, y1, x2, y2],
                        "foot_px":    [(x1+x2)/2.0, float(y2)],
                        "confidence": float(box.conf[0]),
                        "keypoints":  kpts,
                    })
            out.append(players)
        return out

    def _detect_balls_and_rackets(self, frame: np.ndarray):
        """Ball (32) + racket (38) pass — used alongside pose model."""
        results = self.det_model(
            frame,
            classes=[32, 38],
            conf=0.10,
            iou=0.50,
            max_det=10,
            imgsz=1280,
            verbose=False,
            device=_DEVICE,
        )
        balls, rackets = [], []
        for r in results:
            if r.boxes is None:
                continue
            for box in r.boxes:
                cls  = int(box.cls[0])
                conf = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().tolist()
                if cls == 32 and conf >= 0.10:
                    balls.append({
                        "bbox":      [x1, y1, x2, y2],
                        "foot_px":   [(x1+x2)/2.0, (y1+y2)/2.0],
                        "confidence": conf,
                    })
                elif cls == 38 and conf >= 0.18:
                    rackets.append({
                        "bbox":      [x1, y1, x2, y2],
                        "foot_px":   [(x1+x2)/2.0, (y1+y2)/2.0],
                        "confidence": conf,
                    })
        return balls, rackets
