import { useRef, useState, useCallback } from "react";

const WS_URL = "ws://localhost:8000/ws/video";

export default function useVideoSocket() {
  const wsRef = useRef(null);
  const frameCallbackRef = useRef(null);
  const statusRef = useRef("idle");  // avoids stale closure in onclose

  const [status, setStatus] = useState("idle");
  const [players, setPlayers] = useState([]);
  const [ball, setBall] = useState(null);
  const [ballTrail, setBallTrail] = useState([]);
  const [fps, setFps] = useState(0);
  const [firstFrame, setFirstFrame] = useState(null);
  const [needsCalibration, setNeedsCalibration] = useState(false);
  const [shots, setShots] = useState([]);
  const [shotCounts, setShotCounts] = useState({});

  const ballTrailRef = useRef([]);
  const shotsRef = useRef([]);

  const _setStatus = (s) => {
    statusRef.current = s;
    setStatus(s);
  };

  const connect = useCallback((config, onFrame) => {
    // Clean up any existing socket
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    frameCallbackRef.current = onFrame;
    _setStatus("connecting");
    setPlayers([]);
    setFps(0);
    ballTrailRef.current = [];
    setBallTrail([]);
    shotsRef.current = [];
    setShots([]);
    setShotCounts({});

    const socket = new WebSocket(WS_URL);
    wsRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "start", ...config }));
      _setStatus("running");
    };

    socket.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      switch (msg.type) {
        case "first_frame":
          setFirstFrame(msg.frame);
          setNeedsCalibration(!!msg.needs_calibration);
          break;
        case "frame":
          frameCallbackRef.current?.(msg.frame);
          setPlayers(msg.players ?? []);
          setFps(msg.fps ?? 0);
          {
            const b = msg.ball ?? null;
            setBall(b);
            if (b?.court_pos && b.court_pos[0] != null) {
              const next = [...ballTrailRef.current, b.court_pos].slice(-16);
              ballTrailRef.current = next;
              setBallTrail(next);
            }
            if (msg.shot_event) {
              const next = [...shotsRef.current, msg.shot_event].slice(-200);
              shotsRef.current = next;
              setShots(next);
            }
            if (msg.shot_counts) {
              setShotCounts(msg.shot_counts);
            }
          }
          break;
        case "end":
          _setStatus("ended");
          break;
        case "error":
          console.error("[WS backend error]", msg.msg);
          _setStatus("error");
          break;
        default:
          break;
      }
    };

    socket.onerror = () => _setStatus("error");

    socket.onclose = () => {
      // Only reset to idle if we weren't already in a terminal state
      if (statusRef.current === "running" || statusRef.current === "connecting") {
        _setStatus("idle");
      }
    };
  }, []);

  const sendPause = useCallback(() => {
    wsRef.current?.readyState === WebSocket.OPEN &&
      wsRef.current.send(JSON.stringify({ type: "pause" }));
  }, []);

  const sendResume = useCallback(() => {
    wsRef.current?.readyState === WebSocket.OPEN &&
      wsRef.current.send(JSON.stringify({ type: "resume" }));
  }, []);

  const stop = useCallback(() => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop" }));
    }
    if (socket) {
      socket.onclose = null;
      socket.close();
      wsRef.current = null;
    }
    _setStatus("idle");
    setPlayers([]);
    setBall(null);
    setBallTrail([]);
    ballTrailRef.current = [];
    shotsRef.current = [];
    setShots([]);
    setShotCounts({});
    setFps(0);
  }, []);

  const sendCalibration = useCallback((points, courtPoints, boundary, showZones, showLines, showPoses, namedPoints = null, lineSegs = null) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "calibrate",
        points,
        court_points: courtPoints ?? null,
        boundary: boundary ?? null,
        named_points: namedPoints ?? null,
        line_bends: lineSegs ?? null,
        show_zones: showZones,
        show_lines: showLines,
        show_poses: showPoses,
      }));
    }
  }, []);

  const exportShots = useCallback((fmt = "json") => {
    window.open(`http://localhost:8000/shots.${fmt}`, "_blank");
  }, []);

  return {
    status,
    players,
    ball,
    ballTrail,
    fps,
    firstFrame,
    needsCalibration,
    shots,
    shotCounts,
    connect,
    stop,
    sendCalibration,
    sendPause,
    sendResume,
    exportShots,
  };
}
