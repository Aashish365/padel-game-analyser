import cv2
import numpy as np

# Real padel court dimensions (metres)
COURT_W = 10.0
COURT_L = 20.0
NET_Y   = COURT_L / 2          # 10 m
SERVICE_LINE_T1 = NET_Y - 6.95 # 3.05 m from back wall
SERVICE_LINE_T2 = NET_Y + 6.95 # 16.95 m

# Zone definitions: (name, x_min, x_max, y_min, y_max)
ZONES = [
    ("team1_back",      0,           COURT_W,     0,               SERVICE_LINE_T1),
    ("team1_left_srv",  0,           COURT_W / 2, SERVICE_LINE_T1, NET_Y),
    ("team1_right_srv", COURT_W / 2, COURT_W,     SERVICE_LINE_T1, NET_Y),
    ("team2_left_srv",  0,           COURT_W / 2, NET_Y,           SERVICE_LINE_T2),
    ("team2_right_srv", COURT_W / 2, COURT_W,     NET_Y,           SERVICE_LINE_T2),
    ("team2_back",      0,           COURT_W,     SERVICE_LINE_T2, COURT_L),
]

ZONE_COLORS_BGR = {
    "team1_back":       (0,   120, 255),
    "team1_left_srv":   (0,   200, 80),
    "team1_right_srv":  (80,  200, 0),
    "team2_left_srv":   (0,   200, 200),
    "team2_right_srv":  (200, 0,   200),
    "team2_back":       (200, 200, 0),
}

# Known court-coordinate for each of the 6 "court lines" calibration points
COURT_LINE_POINTS = np.float32([
    [0,       NET_Y],
    [COURT_W, NET_Y],
    [0,       SERVICE_LINE_T1],
    [COURT_W, SERVICE_LINE_T1],
    [0,       SERVICE_LINE_T2],
    [COURT_W, SERVICE_LINE_T2],
])


def _midpt(a, b):
    """Return the midpoint between two [x, y] points."""
    return [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]


def _ipt(pts, key):
    """Return point as (x, y) int tuple, or None."""
    p = pts.get(key)
    return (int(p[0]), int(p[1])) if p is not None else None


def _poly(*points):
    """Build an int32 polygon array from a list of (x,y) tuples, skipping Nones."""
    valid = [p for p in points if p is not None]
    if len(valid) < 3:
        return None
    return np.array([valid], dtype=np.int32)


class CourtHomography:
    def __init__(self):
        self.H: np.ndarray | None = None
        self.H_inv: np.ndarray | None = None
        self._image_corners: np.ndarray | None = None
        self._boundary_polygon: np.ndarray | None = None
        self._display_polygon: np.ndarray | None = None
        # Named pixel-space points keyed by feature id (e.g. "net_l", "c_tl", ...)
        self._named_px: dict = {}
        self.calibrated = False

    # ── Calibration ───────────────────────────────────────────

    def calibrate(self,
                  image_points: list[list[float]],
                  court_points: list[list[float]] | None = None,
                  boundary_polygon: list[list[float]] | None = None,
                  named_points: dict | None = None,
                  line_bends: dict | None = None) -> bool:
        """
        image_points:  pixel coords clicked by the user (4+ points).
        court_points:  corresponding court coords in metres.
        boundary_polygon: ordered polygon of the court boundary in pixels.
        named_points:  dict mapping feature id → [px, py] for every point the
                       user placed (e.g. {"net_l": [412, 387], "c_tl": [120, 50], ...}).
                       When provided, zones and lines are drawn directly from these
                       pixel positions — no back-projection needed.
        """
        src = np.float32(image_points)
        n = len(src)

        if court_points is not None and len(court_points) == n:
            dst_m = np.float32(court_points)
        else:
            if n != 4:
                return False
            dst_m = np.float32([
                [0,       0],
                [COURT_W, 0],
                [COURT_W, COURT_L],
                [0,       COURT_L],
            ])

        if n == 4 and court_points is None:
            H = cv2.getPerspectiveTransform(src, dst_m)
        else:
            H, _ = cv2.findHomography(src, dst_m, method=0)

        if H is None:
            return False

        H_inv = np.linalg.inv(H)

        # Back-project court corners → image pixels (for ROI and zone drawing)
        court_corners_m = np.float32([[[0, 0], [COURT_W, 0],
                                       [COURT_W, COURT_L], [0, COURT_L]]])
        img_corners = cv2.perspectiveTransform(court_corners_m, H_inv)[0]

        self.H = H
        self.H_inv = H_inv
        self._image_corners = img_corners

        # Store the user's named pixel positions and bend points for direct drawing
        self._named_px = named_points or {}
        self._line_bends = line_bends or {}

        if boundary_polygon and len(boundary_polygon) >= 4:
            self._boundary_polygon = np.float32(boundary_polygon)
            self._display_polygon  = np.float32(boundary_polygon)
        else:
            self._boundary_polygon = img_corners.copy()
            self._display_polygon  = img_corners.copy()

        self.calibrated = True
        return True

    # ── Coordinate transforms ─────────────────────────────────

    def px_to_court(self, px: float, py: float) -> tuple[float | None, float | None]:
        if not self.calibrated:
            return None, None
        pt  = np.float32([[[px, py]]])
        res = cv2.perspectiveTransform(pt, self.H)
        return float(res[0][0][0]), float(res[0][0][1])

    def court_to_px(self, cx: float, cy: float) -> tuple[float | None, float | None]:
        if not self.calibrated:
            return None, None
        pt  = np.float32([[[cx, cy]]])
        res = cv2.perspectiveTransform(pt, self.H_inv)
        return float(res[0][0][0]), float(res[0][0][1])

    def in_court(self, cx: float, cy: float, margin: float = 0.3) -> bool:
        return (-margin <= cx <= COURT_W + margin) and (-margin <= cy <= COURT_L + margin)

    def get_zone(self, cx: float, cy: float) -> str:
        for name, x1, x2, y1, y2 in ZONES:
            if x1 <= cx < x2 and y1 <= cy < y2:
                return name
        return "out"

    # ── Court mask ────────────────────────────────────────────

    def create_court_mask(self, frame_shape: tuple) -> np.ndarray:
        mask = np.zeros(frame_shape[:2], dtype=np.uint8)
        poly = self._boundary_polygon if self._boundary_polygon is not None else self._image_corners
        if poly is not None:
            cv2.fillPoly(mask, [poly.astype(np.int32)], 255)
        return mask

    def apply_court_mask(self, frame: np.ndarray) -> np.ndarray:
        if not self.calibrated:
            return frame
        mask = self.create_court_mask(frame.shape)
        out  = frame.copy()
        out[mask == 0] = 0
        return out

    def get_roi_bbox(self, frame_shape: tuple, pad: int = 40) -> tuple[int, int, int, int]:
        """
        Bounding box (x, y, w, h) of the calibrated court polygon in pixel space.
        Use this to crop the frame before running YOLO — far-end players become
        larger relative to the detection input, fixing the 4-player miss problem.
        """
        poly = self._boundary_polygon if self._boundary_polygon is not None else self._image_corners
        if poly is None:
            h, w = frame_shape[:2]
            return 0, 0, w, h
        pts = poly.reshape(-1, 2)
        x1 = max(0,               int(pts[:, 0].min()) - pad)
        y1 = max(0,               int(pts[:, 1].min()) - pad)
        x2 = min(frame_shape[1],  int(pts[:, 0].max()) + pad)
        y2 = min(frame_shape[0],  int(pts[:, 1].max()) + pad)
        return x1, y1, x2 - x1, y2 - y1

    def point_in_boundary(self, pt: tuple[int, int]) -> bool:
        """Return True if pixel point (x, y) is inside the boundary polygon."""
        poly = self._boundary_polygon if self._boundary_polygon is not None else self._image_corners
        if poly is None:
            return True  # no boundary set → accept all
        result = cv2.pointPolygonTest(poly.astype(np.float32), (float(pt[0]), float(pt[1])), False)
        return result >= 0  # 1=inside, 0=on edge, -1=outside

    # ── Direct-pixel zone & line helpers ──────────────────────

    def _resolve_named_pts(self):
        """
        Return a resolved dict of all key points needed to draw zones/lines.
        Missing center points are interpolated from the two wall points.
        Returns None if the minimum set of points is not available.
        """
        p = self._named_px

        # Resolve each key point; interpolate center columns when missing
        net_l  = _ipt(p, "net_l")
        net_r  = _ipt(p, "net_r")
        net_c  = _ipt(p, "net_c")  or (tuple(map(int, _midpt(p["net_l"],  p["net_r"])))  if "net_l"  in p and "net_r"  in p else None)

        s1_l   = _ipt(p, "s1_l")
        s1_r   = _ipt(p, "s1_r")
        s1_c   = _ipt(p, "s1_c")  or (tuple(map(int, _midpt(p["s1_l"],   p["s1_r"])))   if "s1_l"  in p and "s1_r"  in p else None)

        s2_l   = _ipt(p, "s2_l")
        s2_r   = _ipt(p, "s2_r")
        s2_c   = _ipt(p, "s2_c")  or (tuple(map(int, _midpt(p["s2_l"],   p["s2_r"])))   if "s2_l"  in p and "s2_r"  in p else None)

        c_tl   = _ipt(p, "c_tl")
        c_tr   = _ipt(p, "c_tr")
        c_bl   = _ipt(p, "c_bl")
        c_br   = _ipt(p, "c_br")

        return {
            "net_l": net_l, "net_r": net_r, "net_c": net_c,
            "s1_l":  s1_l,  "s1_r":  s1_r,  "s1_c":  s1_c,
            "s2_l":  s2_l,  "s2_r":  s2_r,  "s2_c":  s2_c,
            "c_tl":  c_tl,  "c_tr":  c_tr,
            "c_bl":  c_bl,  "c_br":  c_br,
        }

    def _has_direct_pts(self, rp: dict) -> bool:
        """True if we have enough named pixel points to draw zones directly."""
        # Need at least the net and one service line on each side
        return (rp["net_l"] and rp["net_r"] and
                (rp["s1_l"] or rp["s1_r"]) and
                (rp["s2_l"] or rp["s2_r"]))

    # ── Overlays on original frame ────────────────────────────

    def draw_zones(self, frame: np.ndarray, alpha: float = 0.28) -> np.ndarray:
        if not self.calibrated or frame is None or frame.size == 0:
            return frame

        try:
            court_mask = self.create_court_mask(frame.shape)
            overlay    = frame.copy()

            rp = self._resolve_named_pts()

            if self._named_px and self._has_direct_pts(rp):
                # ── Direct polygon fill from user's exact pixel coordinates ──
                # Each zone is a quadrilateral whose vertices are the calibration
                # points the user clicked.  Missing center points are interpolated.
                zone_polys = [
                    # team1_back:  far-left corner → far-right corner → far srv-right → far srv-left
                    ("team1_back",      _poly(rp["c_tl"],  rp["c_tr"],  rp["s1_r"],  rp["s1_l"])),
                    # team1_left_srv:  far-srv-left → far-srv-center → net-center → net-left
                    ("team1_left_srv",  _poly(rp["s1_l"],  rp["s1_c"],  rp["net_c"], rp["net_l"])),
                    # team1_right_srv: far-srv-center → far-srv-right → net-right → net-center
                    ("team1_right_srv", _poly(rp["s1_c"],  rp["s1_r"],  rp["net_r"], rp["net_c"])),
                    # team2_left_srv:  net-left → net-center → near-srv-center → near-srv-left
                    ("team2_left_srv",  _poly(rp["net_l"], rp["net_c"], rp["s2_c"],  rp["s2_l"])),
                    # team2_right_srv: net-center → net-right → near-srv-right → near-srv-center
                    ("team2_right_srv", _poly(rp["net_c"], rp["net_r"], rp["s2_r"],  rp["s2_c"])),
                    # team2_back:      near-srv-left → near-srv-right → near-right corner → near-left corner
                    ("team2_back",      _poly(rp["s2_l"],  rp["s2_r"],  rp["c_br"],  rp["c_bl"])),
                ]

                for name, poly in zone_polys:
                    if poly is not None:
                        cv2.fillPoly(overlay, poly, ZONE_COLORS_BGR[name])

            else:
                # ── Fallback: back-project from homography ──
                if self.H_inv is not None:
                    for name, x1, x2, y1, y2 in ZONES:
                        corners = np.float32([[[x1, y1], [x2, y1], [x2, y2], [x1, y2]]])
                        img_c   = cv2.perspectiveTransform(corners, self.H_inv)
                        pts     = img_c[0].astype(np.int32)
                        cv2.fillPoly(overlay, [pts], ZONE_COLORS_BGR[name])

            blended = frame.copy()
            cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, blended)
            frame[court_mask > 0] = blended[court_mask > 0]
            return frame
        except Exception as e:
            print(f"[homography] Error in draw_zones: {e}")
            return frame

    def _get_line_pts(self, line_id: str) -> list[tuple[int, int]] | None:
        """Helper to get full polyline points (endpoints + bends) for a given line."""
        m = self._named_px
        bends = self._line_bends.get(line_id, [])
        a, b = None, None

        if line_id == 'net':
            if 'net_l' in m and 'net_r' in m:
                a, b = m['net_l'], m['net_r']
        elif line_id == 's_far':
            if 's1_l' in m and 's1_r' in m:
                a, b = m['s1_l'], m['s1_r']
        elif line_id == 's_near':
            if 's2_l' in m and 's2_r' in m:
                a, b = m['s2_l'], m['s2_r']
        elif line_id == 'center':
            a = m.get('s1_c') or (_midpt(m['s1_l'], m['s1_r']) if 's1_l' in m and 's1_r' in m else None)
            b = m.get('s2_c') or (_midpt(m['s2_l'], m['s2_r']) if 's2_l' in m and 's2_r' in m else None)

        if not a or not b:
            return None
            
        pts = [(int(a[0]), int(a[1]))]
        for bend in bends:
            pts.append((int(bend['x']), int(bend['y'])))
        pts.append((int(b[0]), int(b[1])))
        return pts

    def draw_court_lines(self, frame: np.ndarray) -> np.ndarray:
        if not self.calibrated or frame is None or frame.size == 0:
            return frame

        try:
            overlay = frame.copy()
            rp = self._resolve_named_pts()

            if self._named_px and self._has_direct_pts(rp):
                # ── Draw polylines directly from user-clicked pixel points + bends ──
                
                # Outer boundary
                display_poly = self._display_polygon if self._display_polygon is not None else self._image_corners
                if display_poly is not None:
                    cv2.polylines(overlay, [display_poly.astype(np.int32)],
                                  isClosed=True, color=(255, 255, 255), thickness=2)

                # Interior lines
                for line_id in ['net', 's_far', 's_near', 'center']:
                    pts = self._get_line_pts(line_id)
                    if not pts or len(pts) < 2:
                        continue
                    
                    pts_array = np.array(pts, np.int32).reshape((-1, 1, 2))
                    
                    if line_id == 'net':
                        cv2.polylines(overlay, [pts_array], isClosed=False, color=(255, 255, 255), thickness=3)
                    else:
                        cv2.polylines(overlay, [pts_array], isClosed=False, color=(200, 200, 200), thickness=2)

            else:
                # ── Fallback: back-project from homography ──
                if self.H_inv is not None:
                    def _line(p1, p2, color=(255, 255, 255), lw=2):
                        x1, y1 = self.court_to_px(*p1)
                        x2, y2 = self.court_to_px(*p2)
                        if None not in (x1, y1, x2, y2):
                            cv2.line(overlay, (int(x1), int(y1)), (int(x2), int(y2)), color, lw)

                    loop = [(0, 0), (COURT_W, 0), (COURT_W, COURT_L), (0, COURT_L), (0, 0)]
                    for i in range(4):
                        _line(loop[i], loop[i + 1], (255, 255, 255), 2)
                    _line((0, NET_Y), (COURT_W, NET_Y), (255, 255, 255), 3)
                    _line((0, SERVICE_LINE_T1), (COURT_W, SERVICE_LINE_T1), (200, 200, 200), 1)
                    _line((0, SERVICE_LINE_T2), (COURT_W, SERVICE_LINE_T2), (200, 200, 200), 1)
                    _line((COURT_W / 2, SERVICE_LINE_T1), (COURT_W / 2, SERVICE_LINE_T2), (200, 200, 200), 1)

                    display_poly = self._display_polygon if self._display_polygon is not None else self._image_corners
                    if display_poly is not None:
                        cv2.polylines(overlay, [display_poly.astype(np.int32)],
                                      isClosed=True, color=(255, 255, 255), thickness=2)

            frame[:] = overlay
            return frame
        except Exception as e:
            print(f"[homography] Error in draw_court_lines: {e}")
            return frame

