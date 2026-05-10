import { TEAM_COLORS, TEAM_BG, ZONE_LEGEND } from "../config/constants.js";

const SHOT_COLORS = {
  forehand: "#10B981",
  backhand: "#3B82F6",
  smash:    "#EF4444",
  lob:      "#F59E0B",
  volley:   "#8B5CF6",
};

const zoneLabel = (z) =>
  z ? z.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";

const shotLabel = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function PlayerCard({ player }) {
  const color = TEAM_COLORS[player.team] ?? "#888";
  const [cx, cy] = player.court_pos ?? [null, null];
  return (
    <div className="player-card">
      <div className="player-avatar" style={{ background: color }}>{player.id}</div>
      <div className="player-info">
        <div className="player-name">Player {player.id}</div>
        <div className="player-zone">{zoneLabel(player.zone)}</div>
      </div>
      {cx != null && (
        <div className="player-coord">{cx.toFixed(1)}, {cy.toFixed(1)} m</div>
      )}
    </div>
  );
}

function ShotBar({ type, count, total }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const color = SHOT_COLORS[type] ?? "#888";
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
        <span style={{ color, fontWeight: 600 }}>{shotLabel(type)}</span>
        <span style={{ color: "var(--text-3)" }}>{count} <span style={{ color: "var(--text-4)" }}>({pct}%)</span></span>
      </div>
      <div style={{ height: 5, background: "var(--border-dim)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

function PlayerShotCard({ pid, counts, team }) {
  const color = TEAM_COLORS[team] ?? "#888";
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div style={{ background: "var(--surface-alt)", borderRadius: "var(--r-sm)", padding: "8px 10px", marginBottom: 8, border: "1px solid var(--border-dim)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <div style={{ width: 22, height: 22, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff" }}>{pid}</div>
        <span style={{ fontWeight: 600, fontSize: 12 }}>Player {pid}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>{total} shots</span>
      </div>
      {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([type, cnt]) => (
        <ShotBar key={type} type={type} count={cnt} total={total} />
      ))}
    </div>
  );
}

function RecentShots({ shots }) {
  const recent = [...shots].reverse().slice(0, 8);
  if (recent.length === 0) return (
    <p style={{ fontSize: 11, color: "var(--text-3)", fontStyle: "italic" }}>No shots detected yet</p>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {recent.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, padding: "3px 0", borderBottom: "1px solid var(--border-dim)" }}>
          <span style={{
            background: SHOT_COLORS[s.shot_type] ?? "#888",
            color: "#fff", borderRadius: 3, padding: "1px 5px", fontSize: 10, fontWeight: 700, minWidth: 58, textAlign: "center"
          }}>{shotLabel(s.shot_type)}</span>
          <span style={{ color: "var(--text-2)", fontWeight: 600 }}>P{s.player_id}</span>
          <span style={{ color: "var(--text-3)", marginLeft: "auto" }}>{s.zone?.replace(/_/g, " ")}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyTeam() {
  return <p style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic", paddingLeft: 2 }}>Not detected</p>;
}

export default function AnalyticsPanel({ players, fps, status, calibrated, statusLabel, statusBadge, shots, shotCounts, onExportJson, onExportCsv }) {
  const teamA = players.filter((p) => p.team === "A");
  const teamB = players.filter((p) => p.team === "B");
  const totalShots = shots.length;

  // Build team info mapping for shot cards
  const playerTeamMap = {};
  players.forEach(p => { playerTeamMap[p.id] = p.team; });

  return (
    <div className="analytics-panel">

      {/* Header */}
      <div className="panel-header">
        <div className="panel-header-top">
          <h2>Analytics</h2>
          <span className={`badge ${statusBadge}`}>{statusLabel}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <StatBox label="Players" value={players.length} suffix="/4" />
          <StatBox label="Speed"   value={fps > 0 ? fps.toFixed(0) : "—"} suffix={fps > 0 ? " fps" : ""} />
          <StatBox label="Shots"   value={totalShots} suffix="" />
        </div>
      </div>

      {/* Teams */}
      <div className="panel-section">
        <div className="team-label">
          <div className="team-dot" style={{ background: TEAM_COLORS.A }} />
          <span style={{ color: TEAM_COLORS.A }}>Team A</span>
        </div>
        {teamA.length > 0 ? teamA.map((p) => <PlayerCard key={p.id} player={p} />) : <EmptyTeam />}
      </div>
      <div className="panel-section">
        <div className="team-label">
          <div className="team-dot" style={{ background: TEAM_COLORS.B }} />
          <span style={{ color: TEAM_COLORS.B }}>Team B</span>
        </div>
        {teamB.length > 0 ? teamB.map((p) => <PlayerCard key={p.id} player={p} />) : <EmptyTeam />}
      </div>

      {/* Shot Statistics */}
      <div className="panel-section">
        <div className="panel-section-title">Shot Analytics</div>
        {Object.keys(shotCounts).length === 0 ? (
          <p style={{ fontSize: 11, color: "var(--text-3)", fontStyle: "italic" }}>Waiting for shots…</p>
        ) : (
          Object.entries(shotCounts).map(([pid, counts]) => (
            <PlayerShotCard key={pid} pid={pid} counts={counts} team={playerTeamMap[pid] ?? "U"} />
          ))
        )}
      </div>

      {/* Recent shots feed */}
      <div className="panel-section">
        <div className="panel-section-title">Recent Shots</div>
        <RecentShots shots={shots} />
      </div>

      {/* Export */}
      {totalShots > 0 && (
        <div className="panel-section">
          <div className="panel-section-title">Export</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-sm" onClick={onExportJson} style={{ flex: 1 }}>⬇ JSON</button>
            <button className="btn btn-sm" onClick={onExportCsv}  style={{ flex: 1 }}>⬇ CSV</button>
          </div>
        </div>
      )}

      {/* Zone legend */}
      <div className="panel-section">
        <div className="panel-section-title">Court Zones</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
          {ZONE_LEGEND.map(({ color, label }) => (
            <div key={label} className="legend-row">
              <div className="legend-swatch" style={{ background: color }} />
              <span className="legend-label">{label}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

function StatBox({ label, value, suffix }) {
  return (
    <div style={{ flex: 1, background: "var(--surface-alt)", borderRadius: "var(--r-sm)", padding: "8px 10px", border: "1px solid var(--border-dim)" }}>
      <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.03em" }}>
        {value}<span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 500 }}>{suffix}</span>
      </div>
    </div>
  );
}
