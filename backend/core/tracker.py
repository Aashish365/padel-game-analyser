import math
from collections import OrderedDict, deque


class PlayerTracker:
    """
    Centroid-based player tracker with velocity prediction.

    Key improvement over simple centroid tracking:
    When a player is occluded for N frames, their track is extrapolated
    forward using their last measured velocity. This means the player can
    reappear up to max_distance pixels from the *predicted* position (not
    the last seen position), which handles fast movement and short occlusions.
    """

    def __init__(
        self,
        max_disappeared: int   = 60,   # ~2 s at 30 fps — generous for occlusion
        max_distance:    float = 250,  # px from predicted pos (increased for fast players)
        max_per_team:    int   = 2,    # A1/A2 and B1/B2
        vel_frames:      int   = 4,    # frames used to estimate velocity
    ):
        self.objects     = OrderedDict()  # id → last confirmed centroid
        self.disappeared = OrderedDict()  # id → frames since last match
        self.history     = OrderedDict()  # id → deque of recent centroids

        self.max_disappeared = max_disappeared
        self.max_distance    = max_distance
        self.max_per_team    = max_per_team
        self.vel_frames      = vel_frames

    # ── Internals ─────────────────────────────────────────────────────────

    def _next_id(self, team: str) -> str:
        used = set()
        for oid in self.objects:
            if oid.startswith(team):
                try:
                    used.add(int(oid[len(team):]))
                except ValueError:
                    pass
        for n in range(1, self.max_per_team + 3):
            if n not in used:
                return f"{team}{n}"
        return f"{team}{len(self.objects) + 1}"

    def _register(self, centroid, detection):
        cy   = detection.get("cy")
        team = "A" if (cy is not None and cy < 10.0) else ("B" if cy is not None else "U")
        oid  = self._next_id(team)
        self.objects[oid]     = centroid
        self.disappeared[oid] = 0
        self.history[oid]     = deque([centroid], maxlen=30)
        detection["id"]       = oid
        return detection

    def _deregister(self, oid):
        self.objects.pop(oid, None)
        self.disappeared.pop(oid, None)
        self.history.pop(oid, None)

    def _predict(self, oid) -> tuple:
        """
        Extrapolate position using linear velocity from recent history.
        Returns the predicted (x, y) after `disappeared` frames.
        Falls back to last known position if history is too short.
        """
        hist = list(self.history[oid])
        n = min(self.vel_frames, len(hist))
        if n < 2:
            return self.objects[oid]

        recent = hist[-n:]
        # Average velocity over the window (px per frame)
        vx = (recent[-1][0] - recent[0][0]) / (n - 1)
        vy = (recent[-1][1] - recent[0][1]) / (n - 1)

        frames_gone = max(self.disappeared[oid], 1)
        cx, cy = self.objects[oid]
        return (cx + vx * frames_gone, cy + vy * frames_gone)

    # ── Public ────────────────────────────────────────────────────────────

    def update(self, detections: list) -> list:
        """
        Match new detections to existing tracks using greedy nearest-neighbour.
        Disappeared tracks use velocity-predicted positions for matching.
        """
        if not detections:
            for oid in list(self.disappeared):
                self.disappeared[oid] += 1
                if self.disappeared[oid] > self.max_disappeared:
                    self._deregister(oid)
            return []

        centroids = [det["foot_px"] for det in detections]

        if not self.objects:
            return [self._register(c, d) for c, d in zip(centroids, detections)]

        obj_ids = list(self.objects.keys())

        # Use velocity-predicted positions for disappeared tracks
        pred_cents = [
            self._predict(oid) if self.disappeared[oid] > 0 else self.objects[oid]
            for oid in obj_ids
        ]

        # Distance from each predicted track position to each new detection
        D = [
            [math.hypot(pc[0]-ic[0], pc[1]-ic[1]) for ic in centroids]
            for pc in pred_cents
        ]

        used_rows: set = set()
        used_cols: set = set()
        tracked:   list = []

        # Greedy nearest-neighbour assignment
        while len(used_rows) < len(obj_ids) and len(used_cols) < len(centroids):
            min_d, min_r, min_c = float("inf"), -1, -1
            for r in range(len(obj_ids)):
                if r in used_rows:
                    continue
                for c in range(len(centroids)):
                    if c in used_cols:
                        continue
                    if D[r][c] < min_d:
                        min_d, min_r, min_c = D[r][c], r, c

            if min_d > self.max_distance:
                break

            oid = obj_ids[min_r]
            self.objects[oid]     = centroids[min_c]
            self.disappeared[oid] = 0
            self.history[oid].append(centroids[min_c])

            detections[min_c]["id"] = oid
            tracked.append(detections[min_c])
            used_rows.add(min_r)
            used_cols.add(min_c)

        # Age unmatched tracks
        for r in set(range(len(obj_ids))) - used_rows:
            oid = obj_ids[r]
            self.disappeared[oid] += 1
            if self.disappeared[oid] > self.max_disappeared:
                self._deregister(oid)

        # Register new detections
        for c in set(range(len(centroids))) - used_cols:
            tracked.append(self._register(centroids[c], detections[c]))

        return tracked


class BallTracker:
    """
    Temporal ball tracker:
    - Disambiguates multiple YOLO detections via trajectory continuity
    - Rejects stationary balls (spare balls on court)
    - Fills short gaps (occlusion / motion blur)
    - Rejects teleporting detections (implausible jumps)
    - Exposes a trail deque for motion-blur visualisation
    """

    def __init__(
        self,
        history_len:     int   = 14,
        speed_threshold: float = 2.0,   # min avg px/frame to count as "moving"
        max_gap:         int   = 10,    # frames of absence before track drops
        max_jump_px:     float = 500.0, # padel ball is fast — reject only real teleports
        trail_len:       int   = 14,
    ):
        self.history_len     = history_len
        self.speed_threshold = speed_threshold
        self.max_gap         = max_gap
        self.max_jump_px     = max_jump_px

        self._positions: deque = deque(maxlen=history_len)
        self._last_confirmed   = None
        self._gap_count        = 0

        self.trail: deque = deque(maxlen=trail_len)

    def update(self, detections: list):
        if not detections:
            self._positions.append(None)
            self._gap_count += 1
            # Keep last confirmed position during short gaps
            if self._gap_count <= self.max_gap and self._last_confirmed is not None:
                return self._last_confirmed
            return None

        self._gap_count = 0
        candidate = self._pick_candidate(detections)
        pos = candidate["foot_px"]

        # Reject implausible jumps
        if self._last_confirmed is not None:
            lx, ly = self._last_confirmed["foot_px"]
            if math.hypot(pos[0]-lx, pos[1]-ly) > self.max_jump_px:
                self._positions.append(None)
                self._gap_count += 1
                return self._last_confirmed if self._gap_count <= self.max_gap else None

        self._positions.append(pos)

        if self._is_moving():
            self._last_confirmed = candidate
            self.trail.append(pos)
            return candidate

        return None

    def _pick_candidate(self, detections: list):
        if len(detections) == 1:
            return detections[0]
        # Prefer detection closest to trajectory; fall back to highest confidence
        if self._last_confirmed is not None:
            lx, ly = self._last_confirmed["foot_px"]
            nearest = min(detections, key=lambda d: math.hypot(
                d["foot_px"][0]-lx, d["foot_px"][1]-ly))
            if math.hypot(nearest["foot_px"][0]-lx, nearest["foot_px"][1]-ly) <= self.max_jump_px:
                return nearest
        return max(detections, key=lambda d: d["confidence"])

    def _is_moving(self) -> bool:
        pts = [p for p in self._positions if p is not None]
        if len(pts) < 2:
            return False
        steps = [math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1])
                 for i in range(1, len(pts))]
        return (sum(steps) / len(steps)) >= self.speed_threshold
