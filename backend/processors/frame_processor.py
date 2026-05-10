import math
import time

import cv2
import numpy as np

from utils.video import encode_frame

MAX_W = 1280
MAX_PLAYERS = 4

_RACKET_COLOR = (200, 0, 220)   # magenta — distinct from player boxes


def process_frame(frame: np.ndarray, cfg, detector) -> dict:
    hom = cfg.hom

    # ── Normalise to calibration-space resolution ──────────────────────────
    fh, fw = frame.shape[:2]
    if fw > MAX_W:
        frame = cv2.resize(frame, (MAX_W, int(fh * MAX_W / fw)))

    # ── Detect inside court ROI (tiled for far-end players) ───────────────
    raw_players, raw_balls, raw_rackets = _roi_detect(frame, hom, detector, cfg.show_poses)

    # ── Build working canvas ───────────────────────────────────────────────
    work = frame.copy()

    if cfg.show_zones:
        work = hom.draw_zones(work)
    if cfg.show_lines:
        work = hom.draw_court_lines(work)

    # ── Filter + track players ────────────────────────────────────────────
    in_court = _filter_players_to_court(raw_players, hom)
    tracked  = cfg.tracker.update(in_court)

    # ── Associate rackets with nearest tracked player ─────────────────────
    racket_map = _associate_rackets(raw_rackets, tracked)   # pid → racket det

    # ── Filter balls: remove detections near player heads ─────────────────
    raw_balls = _reject_head_detections(raw_balls, tracked)
    if hom.calibrated:
        raw_balls = _filter_balls_to_court(raw_balls, hom)

    # ── Render players + rackets ───────────────────────────────────────────
    players = []
    for det in tracked:
        fx, fy = det["foot_px"]
        pid    = det["id"]

        cx, cy = _to_court(fx, fy, hom)
        zone   = hom.get_zone(cx, cy) if cx is not None else "unknown"

        if isinstance(pid, str) and pid.startswith("A"):
            team, color = "A", (0, 60, 220)
        elif isinstance(pid, str) and pid.startswith("B"):
            team, color = "B", (220, 60, 0)
        else:
            team, color = "U", (0, 200, 0)

        x1, y1, x2, y2 = [int(v) for v in det["bbox"]]
        cv2.rectangle(work, (x1, y1), (x2, y2), color, 2)
        cv2.circle(work, (int(fx), int(fy)), 5, color, -1)
        cv2.putText(work, str(pid), (x1, y1 - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

        if cfg.show_poses and det.get("keypoints"):
            _draw_pose(work, det["keypoints"])

        # Draw racket if associated with this player
        racket_bbox = None
        if pid in racket_map:
            rb = racket_map[pid]["bbox"]
            rb = [int(v) for v in rb]
            cv2.rectangle(work, (rb[0], rb[1]), (rb[2], rb[3]), _RACKET_COLOR, 2)
            cv2.putText(work, "racket", (rb[0], rb[1] - 5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, _RACKET_COLOR, 1)
            racket_bbox = racket_map[pid]["bbox"]

        players.append({
            "id":          pid,
            "bbox":        det["bbox"],
            "foot_px":     det["foot_px"],
            "court_pos":   [_r(cx), _r(cy)],
            "zone":        zone,
            "team":        team,
            "confidence":  round(det["confidence"], 3),
            "racket_bbox": racket_bbox,
            "keypoints":   det.get("keypoints"),   # used by shot classifier
        })

    # ── Ball tracker + render ─────────────────────────────────────────────
    ball_result = cfg.ball_tracker.update(raw_balls)
    ball_data = None
    if ball_result:
        bx, by   = ball_result["foot_px"]
        bcx, bcy = _to_court(bx, by, hom)
        _draw_ball(work, bx, by, cfg.ball_tracker.trail)
        ball_data = {
            "foot_px":   [bx, by],
            "court_pos": [_r(bcx), _r(bcy)],
        }

    # ── Shot classification ───────────────────────────────────────────────
    shot_event = cfg.shot_classifier.update(
        ball_data, players, cfg.frame_count, time.time()
    )
    cfg.frame_count += 1

    # Annotate shot on frame
    if shot_event:
        _draw_shot_label(work, shot_event, players)

    # Strip keypoints from JSON output (they're large; pose is already drawn on frame)
    for p in players:
        p.pop("keypoints", None)

    return {
        "type":         "frame",
        "frame":        encode_frame(work),
        "players":      players,
        "ball":         ball_data,
        "shot_event":   shot_event,
        "shot_counts":  cfg.shot_classifier.shot_counts() if shot_event else None,
        "timestamp":    time.time(),
    }


# ── Detection pipeline ─────────────────────────────────────────────────────

def _roi_detect(frame, hom, detector, run_pose: bool):
    """
    Three-region tiled inference.

    Pass 1 — full court ROI: catches near players, ball, rackets.
    Pass 2 — two far-court tiles (left + right, batched): zooms ~3× on the
              far half so distant players clear YOLO's detection floor.

    Why halving width matters: the court ROI is wider than tall.
    A top-half-only crop keeps the same width → same YOLO scale factor → no zoom.
    Halving BOTH dims makes width the short axis: scale ≈ imgsz/(rw/2) ≈ 3×.
    """
    if not hom.calibrated:
        return detector.detect(frame, run_pose=run_pose)

    rx, ry, rw, rh = hom.get_roi_bbox(frame.shape, pad=40)
    if rw < 10 or rh < 10:
        return detector.detect(frame, run_pose=run_pose)

    # Pass 1: full ROI
    roi_full = frame[ry:ry + rh, rx:rx + rw]
    players, balls, rackets = detector.detect(roi_full, run_pose=run_pose)
    _shift(players, rx, ry)
    _shift(balls,   rx, ry)
    _shift(rackets, rx, ry)

    # Pass 2: far-court L + R tiles — batched single GPU call, players only
    far_h = int(rh * 0.52)
    tw    = min(int(rw * 0.55) + 30, rw)

    tile_l = frame[ry:ry + far_h, rx:rx + tw]
    ox_r   = rx + rw - tw
    tile_r = frame[ry:ry + far_h, ox_r:rx + rw]

    if run_pose:
        batch = detector._detect_pose_batch([tile_l, tile_r])
        for p_list, ox in zip(batch, [rx, ox_r]):
            _shift(p_list, ox, ry)
            players = _nms(players + p_list, iou_thr=0.40)
    else:
        for tile, ox in [(tile_l, rx), (tile_r, ox_r)]:
            if tile.size == 0:
                continue
            p_t, _, _ = detector._detect_combined(tile)
            _shift(p_t, ox, ry)
            players = _nms(players + p_t, iou_thr=0.40)

    return players, balls, rackets


def _shift(dets: list, ox: float, oy: float) -> None:
    """Offset bbox, foot_px, and keypoints in-place."""
    for d in dets:
        fp = d["foot_px"]
        d["foot_px"] = [fp[0] + ox, fp[1] + oy]
        b = d["bbox"]
        d["bbox"] = [b[0] + ox, b[1] + oy, b[2] + ox, b[3] + oy]
        if d.get("keypoints"):
            d["keypoints"] = [[kp[0] + ox, kp[1] + oy, kp[2]] for kp in d["keypoints"]]


def _nms(dets: list, iou_thr: float = 0.45) -> list:
    if len(dets) <= 1:
        return dets
    dets = sorted(dets, key=lambda d: d["confidence"], reverse=True)
    kept = []
    for d in dets:
        if not any(_iou(d["bbox"], k["bbox"]) > iou_thr for k in kept):
            kept.append(d)
    return kept


def _iou(a: list, b: list) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    ua = (a[2] - a[0]) * (a[3] - a[1])
    ub = (b[2] - b[0]) * (b[3] - b[1])
    union = ua + ub - inter
    return inter / union if union > 0 else 0.0


# ── Helpers ────────────────────────────────────────────────────────────────

def _to_court(fx, fy, hom):
    return hom.px_to_court(fx, fy)


def _r(v):
    return round(v, 2) if v is not None else None


def _reject_head_detections(balls: list, tracked_players: list) -> list:
    """
    Remove ball candidates that are near a player's head.

    Padel players are detected with pose keypoints — keypoint 0 is the nose.
    Any 'ball' within ~0.5× player-width of the nose (or the top of the bbox
    when keypoints are absent) is treated as a head false-positive and dropped.
    """
    if not tracked_players:
        return balls

    kept = []
    for ball in balls:
        bx, by = ball["foot_px"]
        reject = False

        for p in tracked_players:
            x1, y1, x2, y2 = p["bbox"]
            pw = max(x2 - x1, 1)

            # Prefer nose keypoint (index 0, COCO skeleton)
            if p.get("keypoints"):
                nose = p["keypoints"][0]
                if nose[2] > 0.3:
                    if math.hypot(bx - nose[0], by - nose[1]) < pw * 0.55:
                        reject = True
                        break

            # Fallback: top 20% of bbox is the head region
            head_cx = (x1 + x2) / 2.0
            head_cy = y1 + (y2 - y1) * 0.15
            if math.hypot(bx - head_cx, by - head_cy) < pw * 0.45:
                reject = True
                break

        if not reject:
            kept.append(ball)
    return kept


def _associate_rackets(rackets: list, players: list) -> dict:
    """
    Map player_id → nearest racket detection.
    A racket is only associated if it is within 220 px of the player's foot point.
    Each racket is assigned to at most one player (greedy, highest-conf first).
    """
    if not rackets or not players:
        return {}

    assignments: dict = {}
    for racket in sorted(rackets, key=lambda r: r["confidence"], reverse=True):
        rx, ry_ = racket["foot_px"]
        best_pid, best_dist = None, float("inf")
        for p in players:
            px, py = p["foot_px"]
            d = math.hypot(rx - px, ry_ - py)
            if d < best_dist and d < 220:
                best_dist = d
                best_pid  = p.get("id")
        if best_pid is not None and best_pid not in assignments:
            assignments[best_pid] = racket
    return assignments


def _filter_players_to_court(detections, hom):
    by_conf = sorted(detections, key=lambda d: d["confidence"], reverse=True)

    if not hom.calibrated:
        for det in by_conf[:MAX_PLAYERS]:
            det.pop("cy", None)
        return by_conf[:MAX_PLAYERS]

    in_court = []
    for det in by_conf:
        if len(in_court) >= MAX_PLAYERS:
            break
        try:
            x1, y1, x2, y2 = det["bbox"]
            w, h = (x2 - x1), (y2 - y1)
            if h > 0 and (w / h) < 0.22:
                continue

            fx, fy = det["foot_px"]
            cx, cy = hom.px_to_court(fx, fy)
            if cx is None:
                continue
            if not hom.in_court(cx, cy, margin=0.15):
                continue
            det["cy"] = cy
            in_court.append(det)
        except (KeyError, TypeError, ValueError):
            continue

    return in_court


def _filter_balls_to_court(detections, hom):
    filtered = []
    for det in detections:
        try:
            bx, by = det["foot_px"]
            cx, cy = hom.px_to_court(bx, by)
            if cx is not None and hom.in_court(cx, cy, margin=2.0):
                filtered.append(det)
        except (KeyError, TypeError, ValueError):
            continue
    return filtered


def _draw_ball(frame: np.ndarray, bx: float, by: float, trail) -> None:
    for i, pos in enumerate(trail):
        alpha  = (i + 1) / max(len(trail), 1)
        radius = max(2, int(4 * alpha))
        color  = (0, int(220 * alpha), int(255 * alpha))
        cv2.circle(frame, (int(pos[0]), int(pos[1])), radius, color, -1)
    cv2.circle(frame, (int(bx), int(by)), 7, (0, 255, 255), -1)
    cv2.circle(frame, (int(bx), int(by)), 7, (0, 0, 0), 1)


def _draw_shot_label(frame: np.ndarray, shot_event: dict, players: list) -> None:
    """Flash the shot type near the hitting player for 1 frame."""
    pid = shot_event.get("player_id")
    label = shot_event["shot_type"].upper()
    # Find player bbox
    for p in players:
        if p["id"] == pid:
            x1, y1 = int(p["bbox"][0]), int(p["bbox"][1])
            cv2.putText(frame, label, (x1, max(y1 - 22, 14)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
            break


def _draw_pose(frame: np.ndarray, keypoints: list) -> None:
    SKELETON = [
        (15, 13), (13, 11), (16, 14), (14, 12), (11, 12),
        (5, 11),  (6, 12),  (5, 6),   (5, 7),   (6, 8),
        (7, 9),   (8, 10),
    ]
    for kx, ky, kconf in keypoints:
        if kconf > 0.5:
            cv2.circle(frame, (int(kx), int(ky)), 3, (0, 255, 0), -1)

    for p1, p2 in SKELETON:
        if p1 < len(keypoints) and p2 < len(keypoints):
            if keypoints[p1][2] > 0.5 and keypoints[p2][2] > 0.5:
                cv2.line(
                    frame,
                    (int(keypoints[p1][0]), int(keypoints[p1][1])),
                    (int(keypoints[p2][0]), int(keypoints[p2][1])),
                    (0, 255, 255), 2,
                )
