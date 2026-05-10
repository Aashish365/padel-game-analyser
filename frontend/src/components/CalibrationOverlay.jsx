import { useState, useRef, useCallback, useEffect } from "react";
import { COURT_W as CW, COURT_L as CL, NET_Y as NET, SRV_T1, SRV_T2 } from "../config/constants.js";

const FEATURES = [
  { id:"net_l",  court:[0,   NET],    label:"Net · Left",        short:"Net L",   desc:"Net meets LEFT wall",               color:"#EF4444", boundary:true  },
  { id:"net_c",  court:[CW/2,NET],    label:"Net · Center",      short:"Net C",   desc:"Net meets center line",             color:"#F97316", boundary:false },
  { id:"net_r",  court:[CW,  NET],    label:"Net · Right",       short:"Net R",   desc:"Net meets RIGHT wall",              color:"#EAB308", boundary:true  },
  { id:"s1_l",   court:[0,   SRV_T1], label:"Far Srv · Left",   short:"SFar L",  desc:"Far service line × left wall",      color:"#3B82F6", boundary:true  },
  { id:"s1_c",   court:[CW/2,SRV_T1], label:"Far Srv · Center", short:"SFar C",  desc:"Far service line × center line",    color:"#6366F1", boundary:false },
  { id:"s1_r",   court:[CW,  SRV_T1], label:"Far Srv · Right",  short:"SFar R",  desc:"Far service line × right wall",     color:"#8B5CF6", boundary:true  },
  { id:"s2_l",   court:[0,   SRV_T2], label:"Near Srv · Left",  short:"SNr L",   desc:"Near service line × left wall",     color:"#10B981", boundary:true  },
  { id:"s2_c",   court:[CW/2,SRV_T2], label:"Near Srv · Center",short:"SNr C",   desc:"Near service line × center line",   color:"#14B8A6", boundary:false },
  { id:"s2_r",   court:[CW,  SRV_T2], label:"Near Srv · Right", short:"SNr R",   desc:"Near service line × right wall",    color:"#06B6D4", boundary:true  },
  { id:"c_tl",   court:[0,   0],       label:"Corner Far-Left",  short:"TL",      desc:"Far-left corner (behind glass)",    color:"#94A3B8", boundary:true  },
  { id:"c_tr",   court:[CW,  0],       label:"Corner Far-Right", short:"TR",      desc:"Far-right corner",                  color:"#94A3B8", boundary:true  },
  { id:"c_bl",   court:[0,   CL],      label:"Corner Near-Left", short:"BL",      desc:"Near-left corner",                  color:"#94A3B8", boundary:true  },
  { id:"c_br",   court:[CW,  CL],      label:"Corner Near-Right",short:"BR",      desc:"Near-right corner",                 color:"#94A3B8", boundary:true  },
];

// Clockwise boundary order (far-left → far-right → down right side → near-right → near-left → up left side)
const BOUNDARY_CW = ["c_tl","c_tr","s1_r","net_r","s2_r","c_br","c_bl","s2_l","net_l","s1_l"];
const FMAP = Object.fromEntries(FEATURES.map(f => [f.id, f]));
const toSvgPt = (cx, cy) => [8 + (cx / CW) * 124, 8 + (cy / CL) * 84];

function ptSegDist(px, py, ax, ay, bx, by) {
  const dx = bx-ax, dy = by-ay, len2 = dx*dx+dy*dy;
  if (!len2) return { dist: Math.hypot(px-ax, py-ay), cx:ax, cy:ay };
  const t = Math.max(0, Math.min(1, ((px-ax)*dx+(py-ay)*dy)/len2));
  const cx = ax+t*dx, cy = ay+t*dy;
  return { dist: Math.hypot(px-cx, py-cy), cx, cy };
}

// ── Interactive court diagram ─────────────────────────────────
function CourtDiagram({ marks, activeId, onSelect }) {
  return (
    <svg viewBox="0 0 140 100" width="100%" style={{ display:"block", cursor:"default" }}
      onClick={e => e.stopPropagation()}>
      <rect x="8" y="8" width="124" height="84" fill="#DBEAFE" stroke="#1E3A5F" strokeWidth="1.5" rx="1" />
      <line x1="8"  y1="50" x2="132" y2="50" stroke="#1E3A5F" strokeWidth="2.5" />
      {[SRV_T1, SRV_T2].map(y => (
        <line key={y} x1="8" y1={8+(y/CL)*84} x2="132" y2={8+(y/CL)*84} stroke="#3B6FA0" strokeWidth="1.2" />
      ))}
      <line x1="70" y1={8+(SRV_T1/CL)*84} x2="70" y2={8+(SRV_T2/CL)*84} stroke="#3B6FA0" strokeWidth="1" strokeDasharray="3,2" />
      <text x="70" y="5"  textAnchor="middle" fontSize="5" fill="#64748B">← far back →</text>
      <text x="70" y="100" textAnchor="middle" fontSize="5" fill="#9CA3AF">▼ camera</text>

      {FEATURES.map((f, fi) => {
        const [sx, sy] = toSvgPt(f.court[0], f.court[1]);
        const placed = !!marks[f.id], isActive = f.id === activeId;
        return (
          <g key={f.id} style={{ cursor:"pointer" }} onClick={() => onSelect(f.id)}>
            <circle cx={sx} cy={sy} r={isActive ? 8 : 5.5}
              fill={placed ? f.color : "white"} stroke={f.color}
              strokeWidth={isActive ? 2.5 : 1.5} opacity={placed || isActive ? 1 : 0.5} />
            <text x={sx} y={sy+2.5} textAnchor="middle" fontSize="5.5" fontWeight="700"
              fill={placed ? "white" : f.color} style={{ pointerEvents:"none", userSelect:"none" }}>
              {placed ? "✓" : fi+1}
            </text>
            {isActive && (
              <circle cx={sx} cy={sy} r={13} fill="none" stroke={f.color}
                strokeWidth="1.5" strokeDasharray="3,2" opacity="0.5">
                <animate attributeName="r"       values="7;13;7"       dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0.1;0.7"  dur="1.5s" repeatCount="indefinite" />
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════
export default function CalibrationOverlay({ firstFrame, initialData, onCalibrate, onCancel }) {
  // marks: {featureId: [natX, natY]} — all placed features, used for H matrix
  const [marks, setMarks]       = useState(initialData?.marks    ?? {});
  // polyPts: ordered boundary polygon [{type:'mark'|'bend', id?, x, y}]
  const [polyPts, setPolyPts]   = useState(initialData?.polyPts  ?? []);
  // lineSegs: bend points for each interior court line (not including endpoints)
  const [lineSegs, setLineSegs] = useState(initialData?.lineSegs ?? { net:[], s_far:[], s_near:[], center:[] });
  const [activeId, setActiveId] = useState("net_l");
  const [dragging, setDragging] = useState(null); // {type:'poly'|'interior'|'line_bend', ...}
  const [bendMode, setBendMode] = useState(false);
  const [hoverPt, setHoverPt]   = useState(null); // {x,y} nat coords preview

  const containerRef  = useRef(null);
  const imgRef        = useRef(null);
  const polyPtsRef    = useRef(polyPts);
  const marksRef      = useRef(marks);
  const lineSegsRef   = useRef(lineSegs);
  useEffect(() => { polyPtsRef.current  = polyPts;   }, [polyPts]);
  useEffect(() => { marksRef.current    = marks;     }, [marks]);
  useEffect(() => { lineSegsRef.current = lineSegs;  }, [lineSegs]);

  const placedCount   = Object.keys(marks).length;
  const boundaryBendCount = polyPts.filter(p => p.type === "bend").length;
  const lineBendCount = Object.values(lineSegs).reduce((s,a) => s + a.length, 0);
  const bendCount     = boundaryBendCount + lineBendCount;
  const canApply      = placedCount >= 4;
  const activeFeature = FMAP[activeId];

  // ── Get ordered point list for an internal line ─────────────
  // Returns [{x,y}, ...] including both endpoints + bend points, or null.
  const getLinePts = (lineId, m, ls) => {
    const mid = (a,b) => [(a[0]+b[0])/2, (a[1]+b[1])/2];
    const bends = ls[lineId] || [];
    let a, b;
    if (lineId === 'net')    { a = m['net_l']; b = m['net_r']; }
    if (lineId === 's_far')  { a = m['s1_l'];  b = m['s1_r'];  }
    if (lineId === 's_near') { a = m['s2_l'];  b = m['s2_r'];  }
    if (lineId === 'center') {
      a = m['s1_c'] || (m['s1_l']&&m['s1_r'] ? mid(m['s1_l'],m['s1_r']) : null);
      b = m['s2_c'] || (m['s2_l']&&m['s2_r'] ? mid(m['s2_l'],m['s2_r']) : null);
    }
    if (!a || !b) return null;
    return [{x:a[0],y:a[1]}, ...bends, {x:b[0],y:b[1]}];
  };

  // ── Layout helpers ─────────────────────────────────────────
  //
  // The <img> uses objectFit:"contain", so the browser scales it to fit inside
  // its element box while preserving aspect ratio.  This can produce transparent
  // bars on the top/bottom OR left/right depending on the container's aspect ratio
  // vs the image's aspect ratio.  All coordinate math MUST use the actual rendered
  // image area — NOT the full element box — otherwise every click is offset by the
  // bar size and calibration points end up in the wrong place.
  //
  const getLayout = () => {
    const img = imgRef.current, con = containerRef.current;
    if (!img || !con) return null;

    const ir  = img.getBoundingClientRect();  // element box in viewport
    const cr  = con.getBoundingClientRect();  // container box in viewport
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    if (!natW || !natH) return null;

    // Scale applied by objectFit:contain (fits both dims, preserves aspect ratio)
    const scale = Math.min(ir.width / natW, ir.height / natH);

    // Actual rendered image size inside the element box
    const rendW = natW * scale;
    const rendH = natH * scale;

    // Centering offset of rendered image within the element box
    const boxOffX = (ir.width  - rendW) / 2;
    const boxOffY = (ir.height - rendH) / 2;

    // Position of rendered image top-left relative to the container div
    // (used by toSVG so dots land on the image, not on the letterbox bars)
    const offX = (ir.left - cr.left) + boxOffX;
    const offY = (ir.top  - cr.top)  + boxOffY;

    return {
      offX, offY,          // rendered image origin inside container (for SVG)
      dW: rendW, dH: rendH, // rendered image size
      toNatX: natW / rendW, // px-in-display → natural pixel (= 1/scale)
      toNatY: natH / rendH,
      toSvgX: rendW / natW, // natural pixel → px-in-display (= scale)
      toSvgY: rendH / natH,
      // Viewport coordinates of rendered image top-left (for clientToNat)
      vpLeft: ir.left + boxOffX,
      vpTop:  ir.top  + boxOffY,
    };
  };

  // Convert natural image pixels → SVG overlay position (relative to container)
  const toSVG = (nx, ny) => {
    const l = getLayout();
    return l ? [l.offX + nx * l.toSvgX, l.offY + ny * l.toSvgY] : [0, 0];
  };

  // Convert viewport click → natural image pixel coordinates
  const clientToNat = (cx, cy) => {
    const l = getLayout();
    if (!l) return null;
    const x = cx - l.vpLeft;
    const y = cy - l.vpTop;
    // Reject clicks outside the actual rendered image area
    if (x < 0 || y < 0 || x > l.dW || y > l.dH) return null;
    return [x * l.toNatX, y * l.toNatY];
  };

  // ── Insert feature into polyPts at correct CW position ─────
  const insertIntoPoly = (id, natX, natY) => {
    setPolyPts(prev => {
      const existIdx = prev.findIndex(p => p.id === id);
      const newPt    = { type:"mark", id, x:natX, y:natY };
      if (existIdx >= 0) return prev.map((p,i) => i===existIdx ? newPt : p);

      if (prev.length === 0) return [newPt];
      const cwIdx = BOUNDARY_CW.indexOf(id);
      const N = BOUNDARY_CW.length;
      let prevPolyIdx = -1;
      for (let d = 1; d < N; d++) {
        const predId = BOUNDARY_CW[(cwIdx-d+N)%N];
        const pi = prev.findIndex(p => p.id === predId);
        if (pi >= 0) { prevPolyIdx = pi; break; }
      }
      const next = [...prev];
      next.splice(prevPolyIdx+1, 0, newPt);
      return next;
    });
  };

  // ── Place the active feature at a natural position ──────────
  const placeFeature = useCallback((natX, natY) => {
    const f = FMAP[activeId];
    if (!f) return;
    setMarks(prev => ({ ...prev, [activeId]: [natX, natY] }));
    if (f.boundary) insertIntoPoly(activeId, natX, natY);

    // Auto-advance to next unplaced
    setMarks(prev => {
      const updated = { ...prev, [activeId]: [natX, natY] };
      const next = FEATURES.find(ft => !updated[ft.id]);
      if (next) setActiveId(next.id);
      return updated;
    });
  }, [activeId]);

  // ── Nearest segment across ALL lines (boundary + interior) ──
  const findNearestSeg = useCallback((natX, natY) => {
    const l = getLayout();
    const thresh = l ? 38 * l.toNatX : 80;
    let best = { dist:Infinity, lineId:'boundary', segIdx:-1, cx:0, cy:0 };

    // Boundary polygon
    const bPts = polyPtsRef.current;
    if (bPts.length >= 2) {
      const N = bPts.length;
      for (let i = 0; i < N; i++) {
        const a = bPts[i], b = bPts[(i+1)%N];
        const r = ptSegDist(natX, natY, a.x, a.y, b.x, b.y);
        if (r.dist < best.dist) best = { dist:r.dist, lineId:'boundary', segIdx:i, cx:r.cx, cy:r.cy };
      }
    }
    // Interior lines
    const m = marksRef.current, ls = lineSegsRef.current;
    for (const lineId of ['net','s_far','s_near','center']) {
      const pts = getLinePts(lineId, m, ls);
      if (!pts || pts.length < 2) continue;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i+1];
        const r = ptSegDist(natX, natY, a.x, a.y, b.x, b.y);
        if (r.dist < best.dist) best = { dist:r.dist, lineId, segIdx:i, cx:r.cx, cy:r.cy };
      }
    }
    return best.dist <= thresh ? best : null;
  }, []);

  // ── Click ───────────────────────────────────────────────────
  const handleClick = useCallback((e) => {
    if (dragging) return;
    const nat = clientToNat(e.clientX, e.clientY);
    if (!nat) return;

    if (bendMode) {
      const seg = findNearestSeg(nat[0], nat[1]);
      if (seg) {
        setHoverPt(null);
        if (seg.lineId === 'boundary') {
          setPolyPts(prev => {
            const next = [...prev];
            next.splice(seg.segIdx+1, 0, { type:"bend", x:nat[0], y:nat[1] });
            return next;
          });
        } else {
          // segIdx in the full pts array (endpoint + bends + endpoint)
          // inserting at bends[segIdx] shifts everything after it right
          setLineSegs(prev => {
            const line = [...(prev[seg.lineId] || [])];
            line.splice(seg.segIdx, 0, { x:nat[0], y:nat[1] });
            return { ...prev, [seg.lineId]: line };
          });
        }
      }
    } else {
      placeFeature(nat[0], nat[1]);
    }
  }, [dragging, bendMode, placeFeature, findNearestSeg]);

  // ── Hover preview ────────────────────────────────────────────
  const handleMouseMove = useCallback((e) => {
    if (!bendMode || dragging) { setHoverPt(null); return; }
    const nat = clientToNat(e.clientX, e.clientY);
    if (!nat) { setHoverPt(null); return; }
    const seg = findNearestSeg(nat[0], nat[1]);
    setHoverPt(seg ? { x:seg.cx, y:seg.cy } : null);
  }, [bendMode, dragging, findNearestSeg]);

  // ── Drag ─────────────────────────────────────────────────────
  const handlePolyDotDown = (e, idx) => {
    e.stopPropagation(); e.preventDefault();
    setDragging({ type:"poly", idx });
  };
  const handleInteriorDotDown = (e, id) => {
    e.stopPropagation(); e.preventDefault();
    setDragging({ type:"interior", id });
  };
  const handleLineBendDown = (e, lineId, bendIdx) => {
    e.stopPropagation(); e.preventDefault();
    setDragging({ type:"line_bend", lineId, bendIdx });
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      const nat = clientToNat(cx, cy);
      if (!nat) return;
      if (dragging.type === "poly") {
        const idx = dragging.idx;
        setPolyPts(prev => prev.map((p,i) => i===idx ? {...p, x:nat[0], y:nat[1]} : p));
        const pt = polyPtsRef.current[idx];
        if (pt?.type === "mark") setMarks(prev => ({ ...prev, [pt.id]: [nat[0], nat[1]] }));
      } else if (dragging.type === "line_bend") {
        const { lineId, bendIdx } = dragging;
        setLineSegs(prev => ({
          ...prev,
          [lineId]: prev[lineId].map((p,i) => i===bendIdx ? {x:nat[0],y:nat[1]} : p),
        }));
      } else {
        setMarks(prev => ({ ...prev, [dragging.id]: [nat[0], nat[1]] }));
      }
    };
    const onUp = () => setTimeout(() => setDragging(null), 10);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive:true });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [dragging]);

  // ── Remove bend point on right-click ─────────────────────────
  const removeBend = (idx) => setPolyPts(prev => prev.filter((_,i) => i!==idx));
  const removeLineBend = (lineId, bendIdx) =>
    setLineSegs(prev => ({ ...prev, [lineId]: prev[lineId].filter((_,i) => i!==bendIdx) }));
  const clearAllLineBends = () => setLineSegs({ net:[], s_far:[], s_near:[], center:[] });

  // ── Remove a placed mark ──────────────────────────────────────
  const removeMark = (id) => {
    setMarks(prev => { const n={...prev}; delete n[id]; return n; });
    setPolyPts(prev => prev.filter(p => p.id !== id));
    setActiveId(id);
  };

  // ── Apply ─────────────────────────────────────────────────────
  const handleApply = () => {
    const imagePts = [], courtPts = [];
    for (const f of FEATURES) {
      if (marks[f.id]) { imagePts.push(marks[f.id]); courtPts.push(f.court); }
    }
    const boundary = polyPts.map(p => [p.x, p.y]);
    onCalibrate(imagePts, courtPts, { marks, polyPts, lineSegs }, boundary);
  };

  // ── Polygon path ──────────────────────────────────────────────
  const polyPath = polyPts.length >= 3
    ? polyPts.map(p => toSVG(p.x, p.y)).map(([x,y],i) => `${i===0?"M":"L"}${x},${y}`).join(" ")+" Z"
    : null;

  // Interior marks (not in polyPts)
  const interiorMarks = FEATURES.filter(f => !f.boundary && marks[f.id]);

  return (
    <div style={{ position:"absolute", inset:0, zIndex:20, display:"flex", flexDirection:"column" }}>
      <div style={{ flex:1, display:"flex", minHeight:0 }}>

        {/* ── LEFT PANEL ─────────────────────────────────────── */}
        <div style={{
          width:230, flexShrink:0, background:"rgba(255,255,255,0.97)",
          borderRight:"1px solid #E3DFD7", display:"flex", flexDirection:"column",
          padding:"12px 12px 10px", gap:10, overflowY:"auto",
          boxShadow:"4px 0 16px rgba(0,0,0,0.12)",
        }}>
          {/* Title */}
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:"#1A1916", marginBottom:2 }}>Court Calibration</div>
            <p style={{ fontSize:10, color:"#9CA3AF", lineHeight:1.5, margin:0 }}>
              Click a point on the diagram below to select it, then click its location on the video.
              Place 4+ points for calibration.
            </p>
          </div>

          {/* Interactive court diagram */}
          <div style={{ borderTop:"1px solid #E3DFD7", paddingTop:10 }}>
            <div style={{ fontSize:10, fontWeight:700, color:"#6B6860", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>
              Click to select a point ({placedCount} placed)
            </div>
            <CourtDiagram marks={marks} activeId={activeId} onSelect={setActiveId} />
          </div>

          {/* Active point indicator */}
          {activeFeature && (
            <div style={{
              background:`${activeFeature.color}12`, border:`1.5px solid ${activeFeature.color}44`,
              borderRadius:8, padding:"8px 10px",
            }}>
              <div style={{ fontSize:11, fontWeight:700, color:activeFeature.color, marginBottom:2 }}>
                ▶ {activeFeature.label}
              </div>
              <div style={{ fontSize:10, color:"#6B6860", lineHeight:1.4 }}>{activeFeature.desc}</div>
              {marks[activeId] && (
                <button style={{ marginTop:6, fontSize:9, color:"#EF4444", background:"none", border:"none", cursor:"pointer", padding:0 }}
                  onClick={() => removeMark(activeId)}>
                  ✕ Remove this point
                </button>
              )}
            </div>
          )}

          {/* Bend lines tool */}
          {placedCount >= 2 && (
            <div style={{ borderTop:"1px solid #E3DFD7", paddingTop:10 }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#6B6860", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>
                Bend Any Line
              </div>
              <p style={{ fontSize:10, color:"#6B6860", lineHeight:1.4, marginBottom:8 }}>
                Click near any line (boundary, net, service, center) to add a bend point for fisheye-distorted courts.
              </p>
              <button
                className={`btn btn-ghost ${bendMode ? "btn-active" : ""}`}
                style={{ width:"100%", fontSize:11 }}
                onClick={() => setBendMode(v => !v)}
              >
                {bendMode ? "✓ Bend mode ON — click near any line" : "Bend Lines"}
              </button>
              {bendCount > 0 && (
                <button className="btn btn-ghost" style={{ width:"100%", fontSize:10, marginTop:4 }}
                  onClick={() => { setPolyPts(prev => prev.filter(p => p.type !== "bend")); clearAllLineBends(); }}>
                  Clear all {bendCount} bend point{bendCount>1?"s":""}
                </button>
              )}
              {bendCount > 0 && (
                <div style={{ marginTop:6, display:"flex", flexWrap:"wrap", gap:3 }}>
                  {[{id:'boundary',label:'Boundary',n:boundaryBendCount},
                    {id:'net',label:'Net',n:(lineSegs.net||[]).length},
                    {id:'s_far',label:'Far Srv',n:(lineSegs.s_far||[]).length},
                    {id:'s_near',label:'Near Srv',n:(lineSegs.s_near||[]).length},
                    {id:'center',label:'Center',n:(lineSegs.center||[]).length}]
                    .filter(l=>l.n>0).map(l=>(
                    <span key={l.id} style={{ fontSize:9, background:"#F1F5F9", borderRadius:10, padding:"2px 6px", color:"#475569" }}>
                      {l.label}: {l.n}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Placed marks list */}
          {placedCount > 0 && (
            <div style={{ borderTop:"1px solid #E3DFD7", paddingTop:10, flex:1 }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#6B6860", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>
                Placed Points
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                {FEATURES.filter(f => marks[f.id]).map(f => (
                  <span key={f.id}
                    onClick={() => setActiveId(f.id)}
                    style={{
                      fontSize:10, fontWeight:600, padding:"3px 7px", borderRadius:20,
                      background:`${f.color}18`, color:f.color, border:`1px solid ${f.color}44`,
                      cursor:"pointer", userSelect:"none",
                      outline: activeId===f.id ? `2px solid ${f.color}` : "none",
                    }}>
                    ✓ {f.short}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── VIDEO + OVERLAY ────────────────────────────────── */}
        <div ref={containerRef}
          style={{
            flex:1, position:"relative", overflow:"hidden",
            cursor: bendMode ? (hoverPt?"crosshair":"default") : dragging ? "grabbing" : "crosshair",
          }}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverPt(null)}
        >
          <img ref={imgRef} src={`data:image/jpeg;base64,${firstFrame}`} alt="Calibration"
            style={{ width:"100%", height:"100%", objectFit:"contain", display:"block", userSelect:"none" }}
            draggable={false}
          />
          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.22)", pointerEvents:"none" }} />

          <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%", overflow:"visible" }}>

            {/* Boundary polygon fill + outline */}
            {polyPath && (
              <>
                <path d={polyPath} fill="rgba(59,130,246,0.08)" />
                <path d={polyPath} fill="none" stroke="#3B82F6" strokeWidth="2" strokeDasharray="8,5" />
              </>
            )}

            {/* Crosshair guides from placed marks */}
            {FEATURES.filter(f => marks[f.id]).map(f => {
              const [x,y] = toSVG(marks[f.id][0], marks[f.id][1]);
              return (
                <g key={`ch-${f.id}`} style={{ pointerEvents:"none" }}>
                  <line x1={0} y1={y} x2="100%" y2={y} stroke={f.color} strokeWidth={0.5} strokeDasharray="4,4" opacity={0.35} />
                  <line x1={x} y1={0} x2={x} y2="100%" stroke={f.color} strokeWidth={0.5} strokeDasharray="4,4" opacity={0.35} />
                </g>
              );
            })}

            {/* Hover bend preview */}
            {hoverPt && (() => {
              const [hx, hy] = toSVG(hoverPt.x, hoverPt.y);
              return <circle cx={hx} cy={hy} r={8} fill="rgba(59,130,246,0.6)" stroke="white" strokeWidth={2} style={{ pointerEvents:"none" }} />;
            })()}

            {/* Draggable polygon points (boundary marks + bend points) */}
            {polyPts.map((pt, idx) => {
              const [x, y] = toSVG(pt.x, pt.y);
              const isDrag = dragging?.type==="poly" && dragging.idx===idx;
              const f = pt.type==="mark" ? FMAP[pt.id] : null;
              const color = f ? f.color : "#6B7280";

              return (
                <g key={idx}
                  style={{ cursor: isDrag ? "grabbing" : "grab" }}
                  onMouseDown={e => handlePolyDotDown(e, idx)}
                  onTouchStart={e => handlePolyDotDown(e, idx)}
                  onContextMenu={pt.type==="bend" ? e => { e.preventDefault(); e.stopPropagation(); removeBend(idx); } : undefined}
                >
                  <circle cx={x} cy={y} r={20} fill="transparent" />
                  {pt.type==="mark" ? (
                    <>
                      <circle cx={x} cy={y+2} r={isDrag?14:11} fill="rgba(0,0,0,0.2)" />
                      <circle cx={x} cy={y}   r={isDrag?14:11} fill={color} stroke="white" strokeWidth={2.5} />
                      <text x={x} y={y+4} textAnchor="middle" fill="white"
                        fontSize={isDrag?11:9} fontWeight="700" fontFamily="Inter,sans-serif"
                        style={{ pointerEvents:"none", userSelect:"none" }}>
                        {isDrag ? "✥" : f?.short?.slice(0,4) ?? "?"}
                      </text>
                    </>
                  ) : (
                    <>
                      <circle cx={x} cy={y} r={isDrag?10:7} fill="#3B82F6" stroke="white" strokeWidth={2} />
                      <text x={x} y={y+3.5} textAnchor="middle" fill="white" fontSize={8}
                        fontWeight="700" style={{ pointerEvents:"none", userSelect:"none" }}>
                        {isDrag ? "✥" : "↔"}
                      </text>
                    </>
                  )}
                  {isDrag && f && (
                    <g>
                      <rect x={x+16} y={y-28} width={92} height={22} rx={6}
                        fill="white" stroke={color} strokeWidth={1.5}
                        style={{ filter:"drop-shadow(0 2px 6px rgba(0,0,0,0.2))" }} />
                      <text x={x+62} y={y-13} textAnchor="middle" fill={color}
                        fontSize={10} fontWeight="600" fontFamily="'SF Mono',monospace"
                        style={{ pointerEvents:"none" }}>
                        {Math.round(pt.x)}, {Math.round(pt.y)} px
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Interior marks (net center, service centers) */}
            {interiorMarks.map(f => {
              const [natX, natY] = marks[f.id];
              const [x, y] = toSVG(natX, natY);
              const isDrag = dragging?.type==="interior" && dragging.id===f.id;
              return (
                <g key={f.id}
                  style={{ cursor: isDrag?"grabbing":"grab" }}
                  onMouseDown={e => handleInteriorDotDown(e, f.id)}
                  onTouchStart={e => handleInteriorDotDown(e, f.id)}>
                  <circle cx={x} cy={y} r={20} fill="transparent" />
                  <circle cx={x} cy={y} r={isDrag?12:9} fill={f.color} stroke="white" strokeWidth={2}
                    strokeDasharray="3,2" />
                  <text x={x} y={y+3.5} textAnchor="middle" fill="white" fontSize={8} fontWeight="700"
                    style={{ pointerEvents:"none", userSelect:"none" }}>
                    {f.short.slice(0,3)}
                  </text>
                </g>
              );
            })}
            {/* Interior court lines (net, service, center) with bend support */}
            {(() => {
              const LINE_STYLE = {
                net:    { stroke:'#FFFFFF', width:2.5, dash:null },
                s_far:  { stroke:'#CCCCCC', width:1.5, dash:'6,4' },
                s_near: { stroke:'#CCCCCC', width:1.5, dash:'6,4' },
                center: { stroke:'#CCCCCC', width:1.5, dash:'6,4' },
              };
              return ['net','s_far','s_near','center'].map(lineId => {
                const pts = getLinePts(lineId, marks, lineSegs);
                if (!pts || pts.length < 2) return null;
                const svgPts = pts.map(p => toSVG(p.x, p.y));
                const d = svgPts.map(([x,y],i) => `${i===0?'M':'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
                const s = LINE_STYLE[lineId];
                const bends = lineSegs[lineId] || [];
                return (
                  <g key={lineId}>
                    {/* Line path */}
                    <path d={d} fill="none" stroke={s.stroke} strokeWidth={s.width}
                      strokeDasharray={s.dash ?? undefined} strokeOpacity={0.8}
                      style={{ pointerEvents:'none' }} />
                    {/* Bend dots */}
                    {bends.map((bend, bendIdx) => {
                      const [bx, by] = toSVG(bend.x, bend.y);
                      const isDrag = dragging?.type==='line_bend' && dragging.lineId===lineId && dragging.bendIdx===bendIdx;
                      return (
                        <g key={bendIdx}
                          style={{ cursor: isDrag?'grabbing':'grab' }}
                          onMouseDown={e => handleLineBendDown(e, lineId, bendIdx)}
                          onTouchStart={e => handleLineBendDown(e, lineId, bendIdx)}
                          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); removeLineBend(lineId, bendIdx); }}
                        >
                          <circle cx={bx} cy={by} r={20} fill="transparent" />
                          <circle cx={bx} cy={by} r={isDrag?10:7} fill="#8B5CF6" stroke="white" strokeWidth={2} />
                          <text x={bx} y={by+3.5} textAnchor="middle" fill="white" fontSize={8}
                            fontWeight="700" style={{ pointerEvents:'none', userSelect:'none' }}>
                            {isDrag ? '✥' : '↔'}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                );
              });
            })()}

          </svg>

          {/* Top instruction banner */}
          <div style={{
            position:"absolute", top:12, left:"50%", transform:"translateX(-50%)",
            background:"rgba(255,255,255,0.97)", borderRadius:30, padding:"8px 20px",
            boxShadow:"0 4px 20px rgba(0,0,0,0.18)",
            border:`1.5px solid ${bendMode ? "#3B82F6" : activeFeature ? activeFeature.color : "#2D6B4B"}`,
            pointerEvents:"none", whiteSpace:"nowrap",
          }}>
            {bendMode ? (
              <span style={{ color:"#1D4ED8", fontWeight:700, fontSize:13 }}>
                Click near any line to bend it
              </span>
            ) : (
              <span style={{ color: activeFeature?.color ?? "#2D6B4B", fontWeight:700, fontSize:13 }}>
                {placedCount < 4
                  ? `Click to place: ${activeFeature?.label ?? "—"} (${placedCount}/4 min)`
                  : marks[activeId]
                    ? `Drag to adjust · or select another point`
                    : `Click to place: ${activeFeature?.label ?? "—"}`
                }
              </span>
            )}
          </div>

          {/* Bend hint */}
          {bendMode && bendCount > 0 && (
            <div style={{
              position:"absolute", bottom:12, left:"50%", transform:"translateX(-50%)",
              background:"rgba(255,255,255,0.9)", borderRadius:20, padding:"5px 14px",
              color:"#6B6860", fontSize:11, pointerEvents:"none",
              boxShadow:"0 2px 8px rgba(0,0,0,0.1)", border:"1px solid #E3DFD7",
            }}>
              Right-click a bend point (↔) to remove it
            </div>
          )}
        </div>
      </div>

      {/* ── BOTTOM BAR ─────────────────────────────────────────── */}
      <div style={{
        padding:"10px 16px", background:"rgba(255,255,255,0.98)", borderTop:"1px solid #E3DFD7",
        display:"flex", gap:8, alignItems:"center", boxShadow:"0 -2px 12px rgba(0,0,0,0.07)",
      }}>
        <div style={{ flex:1, fontSize:11, color:"#6B6860" }}>
          {placedCount} point{placedCount!==1?"s":""} placed
          {placedCount < 4 && <span style={{ color:"#EF4444" }}> — need {4-placedCount} more</span>}
          {bendCount > 0 && <span style={{ color:"#3B82F6", marginLeft:8 }}>· {bendCount} bend point{bendCount>1?"s":""}</span>}
        </div>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-success" disabled={!canApply} onClick={handleApply}>
          Apply Calibration
        </button>
      </div>
    </div>
  );
}
