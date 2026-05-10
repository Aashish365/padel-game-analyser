import { CourtIcon } from "./icons.jsx";

export default function Toolbar({
  // Source
  sourceInput, onSourceChange, onUpload, disabled,
  // Playback
  isRunning, paused, onStart, onStop, onPauseResume,
  // Toggles
  show2D, showZones, showLines, showPoses, calibrationPoints,
  onToggle2D, onToggleZones, onToggleLines, onTogglePoses,
  // Calibration
  firstFrame, onOpenCalibration,
  // Stats
  fps,
}) {
  return (
    <div className="toolbar">
      {/* Brand */}
      <div className="toolbar-brand">
        <div className="toolbar-logo"><CourtIcon /></div>
        <span className="toolbar-title">Padel Game Analyser</span>
      </div>

      <div className="toolbar-divider" />

      {/* Source input */}
      <div className="input-row">
        <input
          placeholder="Video file path…"
          value={sourceInput}
          onChange={(e) => onSourceChange(e.target.value)}
          disabled={isRunning}
        />
      </div>

      <label className="upload-label">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ marginRight: 4 }}>
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
        </svg>
        Upload
        <input type="file" accept="video/*" onChange={onUpload} disabled={isRunning} />
      </label>

      <div className="toolbar-divider" />

      {/* Playback controls */}
      {!isRunning ? (
        <button className="btn btn-primary" onClick={onStart} disabled={!sourceInput}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
          Start
        </button>
      ) : (
        <>
          <button className="btn btn-ghost" onClick={onPauseResume} title={paused ? "Resume" : "Pause"}>
            {paused
              ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg> Resume</>
              : <><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause</>
            }
          </button>
          <button className="btn btn-danger" onClick={onStop}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="1"/></svg>
            Stop
          </button>
        </>
      )}

      {/* Display toggles */}
      <button className={`btn btn-ghost ${show2D ? "btn-active" : ""}`} onClick={onToggle2D} title="Toggle 2D court view">
        2D View
      </button>
      <button className={`btn btn-ghost ${showZones ? "btn-active" : ""}`} onClick={onToggleZones}>
        Zones
      </button>
      <button className={`btn btn-ghost ${showLines ? "btn-active" : ""}`} onClick={onToggleLines}>
        Lines
      </button>
      <button className={`btn btn-ghost ${showPoses ? "btn-active" : ""}`} onClick={onTogglePoses}>
        Poses
      </button>

      <div className="toolbar-divider" />

      {/* Calibration */}
      <button className="btn btn-ghost" onClick={onOpenCalibration} disabled={!firstFrame} title="Calibrate court corners">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
        </svg>
        Calibrate
      </button>

      {calibrationPoints && <span className="badge badge-green">Calibrated</span>}
      {fps > 0 && <span className="fps-badge">{fps.toFixed(1)} fps</span>}
    </div>
  );
}
