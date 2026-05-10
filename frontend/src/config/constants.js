// Court dimensions (metres)
export const COURT_W = 10;
export const COURT_L = 20;
export const NET_Y = 10;
export const SRV_T1 = 3.05;   // far service line
export const SRV_T2 = 16.95;  // near service line

// Team display
export const TEAM_COLORS = { A: "#CF4B2D", B: "#1D4ED8" };
export const TEAM_BG     = { A: "#F5EAE6", B: "#EBF0FD" };

// Zone fills used in the 2D court canvas
export const ZONE_FILLS = [
  ["team1_back",       0,         COURT_W,   0,      SRV_T1, "rgba(59,130,246,0.12)"],
  ["team1_left_srv",   0,         COURT_W/2, SRV_T1, NET_Y,  "rgba(16,185,129,0.12)"],
  ["team1_right_srv",  COURT_W/2, COURT_W,   SRV_T1, NET_Y,  "rgba(132,204,22,0.12)"],
  ["team2_left_srv",   0,         COURT_W/2, NET_Y,  SRV_T2, "rgba(6,182,212,0.12)"],
  ["team2_right_srv",  COURT_W/2, COURT_W,   NET_Y,  SRV_T2, "rgba(168,85,247,0.12)"],
  ["team2_back",       0,         COURT_W,   SRV_T2, COURT_L,"rgba(234,179,8,0.14)"],
];

// Zone legend used in the analytics sidebar
export const ZONE_LEGEND = [
  { color: "rgba(59,130,246,0.55)",  label: "T1 Back"          },
  { color: "rgba(16,185,129,0.55)",  label: "T1 Left Service"  },
  { color: "rgba(132,204,22,0.55)",  label: "T1 Right Service" },
  { color: "rgba(6,182,212,0.55)",   label: "T2 Left Service"  },
  { color: "rgba(168,85,247,0.55)",  label: "T2 Right Service" },
  { color: "rgba(234,179,8,0.6)",    label: "T2 Back"          },
];

// Status display
export const STATUS_LABELS = { idle: "Idle", connecting: "Connecting", running: "Live", ended: "Ended", error: "Error" };
export const STATUS_BADGES = { running: "badge-green", connecting: "badge-amber", error: "badge-red", ended: "badge-blue" };
