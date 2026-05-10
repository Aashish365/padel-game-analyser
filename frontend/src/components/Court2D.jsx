import { useRef, useEffect } from "react";
import { COURT_W, COURT_L, NET_Y, SRV_T1, SRV_T2, ZONE_FILLS, TEAM_COLORS } from "../config/constants.js";

export default function Court2D({ players, ball, ballTrail = [] }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const PAD = 28;
    const sX = (W - PAD * 2) / COURT_W;
    const sY = (H - PAD * 2) / COURT_L;

    const px = (cx) => PAD + cx * sX;
    const py = (cy) => PAD + cy * sY;

    ctx.clearRect(0, 0, W, H);

    // Court surface
    ctx.fillStyle = "#EFF6FF";
    ctx.beginPath();
    ctx.roundRect(px(0), py(0), COURT_W * sX, COURT_L * sY, 4);
    ctx.fill();

    // Zone fills
    for (const [, x1, x2, y1, y2, fill] of ZONE_FILLS) {
      ctx.fillStyle = fill;
      ctx.fillRect(px(x1), py(y1), (x2 - x1) * sX, (y2 - y1) * sY);
    }

    // Court boundary
    ctx.strokeStyle = "#1E3A5F";
    ctx.lineWidth = 2;
    ctx.strokeRect(px(0), py(0), COURT_W * sX, COURT_L * sY);

    // Net
    ctx.strokeStyle = "#1E3A5F";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px(0), py(NET_Y)); ctx.lineTo(px(COURT_W), py(NET_Y));
    ctx.stroke();

    // Service lines
    ctx.strokeStyle = "#3B6FA0";
    ctx.lineWidth = 1;
    [[0, SRV_T1, COURT_W, SRV_T1], [0, SRV_T2, COURT_W, SRV_T2]].forEach(([x1, y1, x2, y2]) => {
      ctx.beginPath(); ctx.moveTo(px(x1), py(y1)); ctx.lineTo(px(x2), py(y2)); ctx.stroke();
    });

    // Center line (between service lines only)
    ctx.beginPath();
    ctx.moveTo(px(COURT_W / 2), py(SRV_T1));
    ctx.lineTo(px(COURT_W / 2), py(SRV_T2));
    ctx.stroke();

    // Labels
    ctx.font = "600 9px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(30,58,95,0.4)";
    ctx.fillText("TEAM 1", W / 2, py(COURT_L * 0.15));
    ctx.fillText("NET",    W / 2, py(NET_Y) - 6);
    ctx.fillText("TEAM 2", W / 2, py(COURT_L * 0.88));

    // Players
    players.forEach((p) => {
      const [cx, cy] = p.court_pos ?? [null, null];
      if (cx == null || cy == null) return;
      const x = px(cx), y = py(cy);

      const color = TEAM_COLORS[p.team] ?? "#10B981";

      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#fff";
      ctx.font = "bold 9px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.id, x, y);
      ctx.textBaseline = "alphabetic";
    });

    // Ball trail
    ballTrail.forEach(([tcx, tcy], i) => {
      if (tcx == null || tcy == null) return;
      const alpha = (i + 1) / Math.max(ballTrail.length, 1);
      ctx.beginPath();
      ctx.arc(px(tcx), py(tcy), Math.max(2, 4 * alpha), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(234,179,8,${alpha * 0.6})`;
      ctx.fill();
    });

    // Ball
    if (ball?.court_pos) {
      const [bcx, bcy] = ball.court_pos;
      if (bcx != null && bcy != null) {
        const bx = px(bcx), by = py(bcy);
        ctx.beginPath();
        ctx.arc(bx, by, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#EAB308";
        ctx.fill();
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    ctx.shadowBlur = 0;
  }, [players, ball, ballTrail]);

  return (
    <div className="court-2d-pane">
      <h3>2D Court View</h3>
      <canvas
        ref={canvasRef}
        width={280}
        height={520}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          borderRadius: 10,
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-md)",
        }}
      />
    </div>
  );
}
