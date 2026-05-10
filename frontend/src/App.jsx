import { useState, useRef, useCallback, useEffect } from "react";

import Toolbar from "./components/Toolbar.jsx";
import Court2D from "./components/Court2D.jsx";
import AnalyticsPanel from "./components/AnalyticsPanel.jsx";
import CalibrationOverlay from "./components/CalibrationOverlay.jsx";
import { VideoIcon } from "./components/icons.jsx";
import useVideoSocket from "./hooks/useVideoSocket.js";
import useCalibration from "./hooks/useCalibration.js";
import useDisplaySettings from "./hooks/useDisplaySettings.js";
import useVideoSource from "./hooks/useVideoSource.js";
import { STATUS_LABELS, STATUS_BADGES } from "./config/constants.js";

export default function App() {
  const socket  = useVideoSocket();
  const calib   = useCalibration();
  const display = useDisplaySettings();
  const src     = useVideoSource();

  const canvasRef          = useRef(null);
  const calibWasPausedRef  = useRef(false);
  const [paused, setPaused] = useState(false);

  const isRunning = socket.status === "running" || socket.status === "connecting";

  // Clear canvas when session ends
  useEffect(() => {
    if (socket.status === "idle" || socket.status === "ended") {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = 0;
        canvas.height = 0;
      }
      setPaused(false);
    }
  }, [socket.status]);

  // Auto-open calibration when first frame arrives uncalibrated
  useEffect(() => {
    if (socket.firstFrame && socket.needsCalibration && !calib.calibrationPoints) {
      socket.sendPause();
      setPaused(true);
      calibWasPausedRef.current = true;
      calib.setCalibrating(true);
    }
  }, [socket.firstFrame, socket.needsCalibration, calib.calibrationPoints]);

  const handleFrame = useCallback((b64) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${b64}`;
  }, []);

  // Push display settings update to backend
  const sendUpdate = useCallback((zones, lines, poses) => {
    if (!isRunning) return;
    socket.sendCalibration(
      calib.calibrationPoints    ?? [],
      calib.calibrationCourtPts  ?? null,
      calib.calibrationBoundary  ?? null,
      zones, lines, poses,
      calib.calibrationMarks     ?? null,
      calib.calibrationLineSegs  ?? null,
    );
  }, [isRunning, socket, calib]);

  const handleStart = () => {
    if (!src.sourceInput && !src.localFilePath) return;
    socket.connect({
      source_type:  "path",
      source:       src.localFilePath ?? src.sourceInput,
      calibration:  calib.calibrationPoints   ?? null,
      court_points: calib.calibrationCourtPts ?? null,
      boundary:     calib.calibrationBoundary ?? null,
      named_points: calib.calibrationMarks    ?? null,
      line_bends:   calib.calibrationLineSegs ?? null,
      show_zones:   display.showZones,
      show_lines:   display.showLines,
      show_poses:   display.showPoses,
    }, handleFrame);
  };

  const openCalibration = () => {
    if (isRunning && !paused) {
      socket.sendPause();
      setPaused(true);
      calibWasPausedRef.current = true;
    } else {
      calibWasPausedRef.current = false;
    }
    calib.setCalibrating(true);
  };

  const resumeAfterCalib = () => {
    if (calibWasPausedRef.current && isRunning) {
      socket.sendResume();
      setPaused(false);
    }
    calibWasPausedRef.current = false;
  };

  const handleCalibrate = (imagePts, courtPts, calibData, boundary) => {
    calib.applyCalibration(imagePts, courtPts, calibData, boundary);
    if (isRunning) {
      socket.sendCalibration(
        imagePts, courtPts, boundary,
        display.showZones, display.showLines, display.showPoses,
        calibData?.marks ?? null, calibData?.lineSegs ?? null,
      );
    }
    resumeAfterCalib();
  };

  const toggleZones = () => { const n = !display.showZones; display.setShowZones(n); sendUpdate(n, display.showLines, display.showPoses); };
  const toggleLines = () => { const n = !display.showLines; display.setShowLines(n); sendUpdate(display.showZones, n, display.showPoses); };
  const togglePoses = () => { const n = !display.showPoses; display.setShowPoses(n); sendUpdate(display.showZones, display.showLines, n); };

  const statusLabel = STATUS_LABELS[socket.status] ?? "Idle";
  const statusBadge = STATUS_BADGES[socket.status] ?? "badge-blue";

  return (
    <div className="app">

      {/* ── Left 70% ── */}
      <div className="video-section">
        <Toolbar
          sourceInput={src.sourceInput}
          onSourceChange={src.setSource}
          onUpload={src.handleUpload}
          isRunning={isRunning}
          paused={paused}
          onStart={handleStart}
          onStop={socket.stop}
          onPauseResume={() => {
            if (paused) { socket.sendResume(); setPaused(false); }
            else        { socket.sendPause();  setPaused(true);  }
          }}
          show2D={display.show2D}
          showZones={display.showZones}
          showLines={display.showLines}
          showPoses={display.showPoses}
          calibrationPoints={calib.calibrationPoints}
          onToggle2D={() => display.setShow2D((v) => !v)}
          onToggleZones={toggleZones}
          onToggleLines={toggleLines}
          onTogglePoses={togglePoses}
          firstFrame={socket.firstFrame}
          onOpenCalibration={openCalibration}
          fps={socket.fps}
        />

        <div className="video-container">
          {/* Video pane */}
          <div className={`video-pane ${display.show2D ? "split" : ""}`}>
            {socket.firstFrame || socket.status === "running" ? (
              <canvas
                ref={canvasRef}
                style={{ maxWidth: "100%", maxHeight: "100%", display: "block", margin: "auto" }}
              />
            ) : (
              <EmptyState status={socket.status} />
            )}

            {calib.calibrating && socket.firstFrame && (
              <CalibrationOverlay
                firstFrame={socket.firstFrame}
                initialData={calib.calibrationData}
                onCalibrate={handleCalibrate}
                onCancel={() => { calib.setCalibrating(false); resumeAfterCalib(); }}
              />
            )}
          </div>

          {/* Optional 2D court split */}
          {display.show2D && <Court2D players={socket.players} ball={socket.ball} ballTrail={socket.ballTrail} />}
        </div>
      </div>

      {/* ── Right 30% ── */}
      <AnalyticsPanel
        players={socket.players}
        fps={socket.fps}
        status={socket.status}
        calibrated={!!calib.calibrationPoints}
        statusLabel={statusLabel}
        statusBadge={statusBadge}
        shots={socket.shots}
        shotCounts={socket.shotCounts}
        onExportJson={() => socket.exportShots("json")}
        onExportCsv={() => socket.exportShots("csv")}
      />
    </div>
  );
}

function EmptyState({ status }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon"><VideoIcon /></div>
      <h3>No video source</h3>
      <p>Enter a YouTube URL, paste a file path, or upload a video — then click Start.</p>
      {status === "error" && (
        <span className="badge badge-red">Cannot connect to backend — is it running?</span>
      )}
    </div>
  );
}
