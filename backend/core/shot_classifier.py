"""
Shot classification for padel analytics.

Hit detection: ball trajectory reversal (dot product of pre/post velocities < 0).
Shot typing:   COCO pose keypoints + court zone + ball trajectory.

Supported shot types:
  smash     — overhead, wrist(s) above shoulder
  lob       — post-hit ball travels strongly upward
  volley    — player near net, no full swing
  forehand  — racket wrist on same side as ball relative to body centre
  backhand  — racket wrist crosses body to the opposite side
"""

import csv
import io
import json
import math
from collections import deque
from typing import Optional

# ── Tuning constants ───────────────────────────────────────────────────────
_VEL_WINDOW       = 5     # frames each side for pre/post velocity estimation
_MIN_BALL_SPEED   = 4.0   # px/frame  — ignore stationary ball
_HIT_PROXIMITY    = 170   # px        — max distance: ball → player at contact
_COOLDOWN_FRAMES  = 18    # min frames between consecutive shots (~1.8 s at 10 fps)
_NET_Y_MIN        = 7.5   # court metres — volley zone boundaries
_NET_Y_MAX        = 12.5
_SMASH_Y_MARGIN   = 15    # px        — wrist must be this far above shoulder


# COCO-17 keypoint indices
_KP_NOSE           = 0
_KP_L_SHOULDER, _KP_R_SHOULDER = 5, 6
_KP_L_ELBOW,    _KP_R_ELBOW    = 7, 8
_KP_L_WRIST,    _KP_R_WRIST    = 9, 10
_KP_L_HIP,      _KP_R_HIP      = 11, 12


class ShotClassifier:
    """
    Stateful, per-session shot classifier.

    Call update() once per frame; it returns a shot-event dict when a shot is
    detected, otherwise None.  All detected shots accumulate in self.shots.
    """

    def __init__(self):
        self._buf: deque = deque(maxlen=_VEL_WINDOW * 2 + 2)
        self._cooldown   = 0
        self.shots: list = []

    # ── Public ────────────────────────────────────────────────────────────

    def update(
        self,
        ball_data: Optional[dict],
        players:   list,
        frame_idx: int,
        timestamp: float,
    ) -> Optional[dict]:
        """
        Returns a shot-event dict when a hit is confirmed, otherwise None.

        ball_data — dict with 'foot_px' and 'court_pos' keys (from frame result).
        players   — list of processed player dicts (must include 'keypoints').
        """
        self._cooldown = max(0, self._cooldown - 1)

        if ball_data is None or not players:
            self._buf.clear()
            return None

        self._buf.append((ball_data["foot_px"], frame_idx, timestamp))

        buf = list(self._buf)
        if len(buf) < _VEL_WINDOW + 2 or self._cooldown > 0:
            return None

        mid    = len(buf) // 2
        v_pre  = _avg_vel(buf[:mid])
        v_post = _avg_vel(buf[mid:])
        if v_pre is None or v_post is None:
            return None

        spd_pre  = math.hypot(*v_pre)
        spd_post = math.hypot(*v_post)
        if spd_pre < _MIN_BALL_SPEED and spd_post < _MIN_BALL_SPEED:
            return None

        # Direction reversal = hit
        if v_pre[0] * v_post[0] + v_pre[1] * v_post[1] >= 0:
            return None

        hit_pos, hit_frame, hit_ts = buf[mid]
        player = _nearest_player(hit_pos, players)
        if player is None:
            return None

        shot_type = _classify(player, hit_pos, v_pre, v_post)

        record = {
            "frame":      hit_frame,
            "timestamp":  round(hit_ts, 3),
            "player_id":  player["id"],
            "team":       player.get("team", "U"),
            "shot_type":  shot_type,
            "zone":       player.get("zone", "unknown"),
            "court_pos":  player.get("court_pos"),
            "ball_court": ball_data.get("court_pos"),
        }
        self.shots.append(record)
        self._cooldown = _COOLDOWN_FRAMES
        self._buf.clear()   # reset — avoids re-triggering on the same event
        return record

    def shot_counts(self) -> dict:
        """Returns {player_id: {shot_type: count}} for all recorded shots."""
        counts: dict = {}
        for s in self.shots:
            pid = s["player_id"]
            st  = s["shot_type"]
            counts.setdefault(pid, {})
            counts[pid][st] = counts[pid].get(st, 0) + 1
        return counts

    def team_counts(self) -> dict:
        """Returns {team: {shot_type: count}}."""
        counts: dict = {}
        for s in self.shots:
            t  = s["team"]
            st = s["shot_type"]
            counts.setdefault(t, {})
            counts[t][st] = counts[t].get(st, 0) + 1
        return counts

    def to_json(self) -> str:
        return json.dumps(
            {
                "shots":       self.shots,
                "total":       len(self.shots),
                "by_player":   self.shot_counts(),
                "by_team":     self.team_counts(),
            },
            indent=2,
        )

    def to_csv(self) -> str:
        if not self.shots:
            return ""
        f = io.StringIO()
        # Flatten nested fields for CSV
        rows = []
        for s in self.shots:
            row = dict(s)
            cp = row.pop("court_pos", None) or [None, None]
            bc = row.pop("ball_court", None) or [None, None]
            row["player_cx"] = cp[0]
            row["player_cy"] = cp[1]
            row["ball_cx"]   = bc[0]
            row["ball_cy"]   = bc[1]
            rows.append(row)
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
        return f.getvalue()

    def reset(self):
        self._buf.clear()
        self._cooldown = 0
        self.shots.clear()


# ── Internal helpers ───────────────────────────────────────────────────────

def _avg_vel(buf: list):
    """Average frame-to-frame pixel velocity over a buffer of (pos, frame, ts)."""
    pts = [b[0] for b in buf]
    if len(pts) < 2:
        return None
    n  = len(pts) - 1
    dx = sum(pts[i][0] - pts[i - 1][0] for i in range(1, len(pts))) / n
    dy = sum(pts[i][1] - pts[i - 1][1] for i in range(1, len(pts))) / n
    return dx, dy


def _nearest_player(ball_pos, players):
    """Return the player closest to ball_pos (foot OR hand region), within _HIT_PROXIMITY."""
    bx, by = ball_pos
    best, best_d = None, float("inf")
    for p in players:
        px, py       = p["foot_px"]
        x1, y1, x2, y2 = p["bbox"]
        hand_cx = (x1 + x2) / 2.0
        hand_cy = y1 + (y2 - y1) * 0.28   # upper-quarter = striking zone
        d = min(
            math.hypot(bx - px,      by - py),
            math.hypot(bx - hand_cx, by - hand_cy),
        )
        if d < best_d:
            best_d = d
            best   = p
    return best if best_d < _HIT_PROXIMITY else None


def _classify(player, ball_pos, v_pre, v_post) -> str:
    """
    Classify shot type from pose keypoints + trajectory + zone.

    Priority order: smash → lob → volley → forehand / backhand.
    """
    kpts = player.get("keypoints")

    # ── Smash / Overhead ──────────────────────────────────────────────────
    if _is_overhead(kpts, v_pre):
        return "smash"

    # ── Lob ───────────────────────────────────────────────────────────────
    # Post-hit ball travels strongly upward (image y decreases = moving up).
    if v_post[1] < -7 and abs(v_post[1]) > abs(v_post[0]) * 0.7:
        return "lob"

    # ── Volley ────────────────────────────────────────────────────────────
    court_pos = player.get("court_pos") or [None, None]
    if court_pos[1] is not None and _NET_Y_MIN < court_pos[1] < _NET_Y_MAX:
        return "volley"

    # ── Forehand / Backhand ───────────────────────────────────────────────
    return _forehand_or_backhand(kpts, ball_pos)


def _is_overhead(kpts, v_pre) -> bool:
    """True if arm is raised (wrist clearly above shoulder) or ball was dropping fast."""
    if kpts:
        for w_i, s_i in [(_KP_L_WRIST, _KP_L_SHOULDER), (_KP_R_WRIST, _KP_R_SHOULDER)]:
            if w_i < len(kpts) and s_i < len(kpts):
                w, s = kpts[w_i], kpts[s_i]
                if w[2] > 0.3 and s[2] > 0.3:
                    if w[1] < s[1] - _SMASH_Y_MARGIN:   # wrist clearly above shoulder
                        return True
    # Fallback: ball was dropping quickly (positive image-y = downward)
    return v_pre[1] > 8


def _forehand_or_backhand(kpts, ball_pos) -> str:
    """
    Forehand:  active (racket) wrist is on the SAME side as the ball relative to
               the shoulder-midpoint (body centre).
    Backhand:  wrist crosses to the OPPOSITE side.
    """
    if kpts is None or len(kpts) < _KP_R_WRIST + 1:
        return "forehand"

    ls, rs = kpts[_KP_L_SHOULDER], kpts[_KP_R_SHOULDER]
    lw, rw = kpts[_KP_L_WRIST],    kpts[_KP_R_WRIST]

    if ls[2] < 0.3 or rs[2] < 0.3:
        return "forehand"

    body_cx = (ls[0] + rs[0]) / 2.0
    ball_x  = ball_pos[0]

    # Choose whichever wrist is closer to the ball as the striking wrist
    lw_vis = lw[2] > 0.3
    rw_vis = rw[2] > 0.3
    if lw_vis and rw_vis:
        dl = math.hypot(ball_x - lw[0], ball_pos[1] - lw[1])
        dr = math.hypot(ball_x - rw[0], ball_pos[1] - rw[1])
        active_x = lw[0] if dl < dr else rw[0]
    elif lw_vis:
        active_x = lw[0]
    elif rw_vis:
        active_x = rw[0]
    else:
        return "forehand"

    ball_right   = ball_x   > body_cx
    wrist_right  = active_x > body_cx
    return "forehand" if ball_right == wrist_right else "backhand"
