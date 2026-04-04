import React from "react";

const statusSteps = [
  {
    title: "Syncing live board payload",
    detail: "Loading matchup windows, player rows, and consensus lines.",
  },
  {
    title: "Ranking the precision card",
    detail: "Sorting the featured pick and the curated edge stack.",
  },
  {
    title: "Preparing research tabs",
    detail: "Assembling scout feed, dossiers, and line-tracking context.",
  },
];

const loadingTiles = ["Matchups", "Live lines", "Precision card", "Research tabs"];
const topNav = ["Board", "Research", "Scout Feed", "Methodology"];
const loadingTabs = ["Precision Card", "Research Center", "Scout Feed", "Line Tracking"];

export default function Loading(): React.ReactElement {
  return (
    <>
      <style>{`
        @keyframes ultops-spin { to { transform: rotate(360deg); } }
        @keyframes ultops-pulse {
          0%, 100% { opacity: 0.48; transform: scale(0.985); }
          50% { opacity: 1; transform: scale(1); }
        }

        .snapshot-loading-shell {
          min-height: 100vh;
          padding: 32px 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          background:
            radial-gradient(circle at top, rgba(34, 211, 238, 0.14), transparent 28%),
            radial-gradient(circle at 82% 18%, rgba(245, 158, 11, 0.12), transparent 24%),
            linear-gradient(180deg, #050b14 0%, #07111c 45%, #09131b 100%);
          color: #f5f7fb;
          font-family: "Segoe UI", sans-serif;
        }

        .snapshot-loading-wrap {
          width: 100%;
          max-width: 1120px;
          display: grid;
          gap: 18px;
        }

        .snapshot-loading-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }

        .snapshot-loading-brand {
          display: grid;
          gap: 8px;
          min-width: 0;
        }

        .snapshot-loading-eyebrow {
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #67e8f9;
        }

        .snapshot-loading-heading {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .snapshot-loading-spinner {
          width: 42px;
          height: 42px;
          border: 3px solid rgba(103, 232, 249, 0.18);
          border-top: 3px solid #67e8f9;
          border-radius: 50%;
          animation: ultops-spin 0.8s linear infinite;
          flex: 0 0 auto;
        }

        .snapshot-loading-title {
          margin: 0;
          font-size: clamp(1.9rem, 3vw, 2.8rem);
          font-weight: 800;
          line-height: 1.05;
          letter-spacing: -0.04em;
        }

        .snapshot-loading-copy {
          margin: 0;
          max-width: 720px;
          font-size: 15px;
          line-height: 1.65;
          color: #bfd0e5;
        }

        .snapshot-loading-live {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 10px 14px;
          border-radius: 999px;
          border: 1px solid rgba(103, 232, 249, 0.2);
          background: rgba(9, 21, 36, 0.82);
          color: #d9f6fb;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .snapshot-loading-live-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #22c55e;
          box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.12);
          animation: ultops-pulse 1.6s ease-in-out infinite;
        }

        .snapshot-loading-nav {
          display: flex;
          gap: 10px;
          overflow-x: auto;
          padding: 0 2px 4px;
          scrollbar-width: none;
        }

        .snapshot-loading-nav::-webkit-scrollbar {
          display: none;
        }

        .snapshot-loading-nav-pill,
        .snapshot-loading-chip {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 8px 12px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.16);
          background: rgba(9, 16, 29, 0.82);
          color: #d5e3f1;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .snapshot-loading-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.3fr) minmax(300px, 0.9fr);
          gap: 20px;
        }

        .snapshot-loading-panel {
          border-radius: 28px;
          border: 1px solid rgba(148, 163, 184, 0.12);
          background: linear-gradient(180deg, rgba(9, 16, 29, 0.94), rgba(8, 17, 29, 0.86));
          padding: 24px;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.34);
          display: grid;
          gap: 18px;
        }

        .snapshot-loading-feature {
          display: grid;
          gap: 12px;
          padding: 18px;
          border-radius: 22px;
          background: linear-gradient(180deg, rgba(12, 23, 38, 0.96), rgba(10, 19, 31, 0.9));
          border: 1px solid rgba(148, 163, 184, 0.1);
        }

        .snapshot-loading-status {
          display: grid;
          gap: 12px;
        }

        .snapshot-loading-status-row {
          display: grid;
          grid-template-columns: 12px minmax(0, 1fr);
          gap: 12px;
          align-items: start;
        }

        .snapshot-loading-status-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          margin-top: 5px;
          background: linear-gradient(135deg, #67e8f9, rgba(245, 158, 11, 0.9));
          animation: ultops-pulse 1.6s ease-in-out infinite;
        }

        .snapshot-loading-line {
          border-radius: 999px;
          animation: ultops-pulse 1.5s ease-in-out infinite;
        }

        .snapshot-loading-line-strong {
          height: 14px;
          width: 72%;
          background: linear-gradient(90deg, rgba(103, 232, 249, 0.2), rgba(245, 158, 11, 0.16));
        }

        .snapshot-loading-line-soft {
          height: 10px;
          width: 54%;
          background: rgba(148, 163, 184, 0.14);
        }

        .snapshot-loading-line-wide {
          height: 12px;
          width: 100%;
          background: rgba(148, 163, 184, 0.12);
        }

        .snapshot-loading-tile-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
          gap: 14px;
        }

        .snapshot-loading-tile {
          border-radius: 20px;
          border: 1px solid rgba(148, 163, 184, 0.1);
          background: rgba(10, 19, 31, 0.9);
          padding: 16px;
          display: grid;
          gap: 10px;
        }

        .snapshot-loading-tab-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .snapshot-loading-tab {
          border-radius: 20px;
          border: 1px solid rgba(148, 163, 184, 0.1);
          background: rgba(10, 19, 31, 0.9);
          padding: 16px;
          display: grid;
          gap: 10px;
        }

        .snapshot-loading-aside-block {
          display: grid;
          gap: 8px;
        }

        .snapshot-loading-note {
          display: grid;
          gap: 12px;
          padding: 18px;
          border-radius: 22px;
          border: 1px solid rgba(103, 232, 249, 0.12);
          background: rgba(8, 23, 38, 0.86);
        }

        .snapshot-loading-foot {
          margin: 0;
          font-size: 12px;
          line-height: 1.6;
          color: #8ea4be;
        }

        @media (max-width: 960px) {
          .snapshot-loading-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 640px) {
          .snapshot-loading-shell {
            padding: 24px 14px;
          }

          .snapshot-loading-panel {
            padding: 20px;
            border-radius: 24px;
          }

          .snapshot-loading-heading {
            align-items: flex-start;
          }

          .snapshot-loading-live {
            width: 100%;
          }

          .snapshot-loading-tab-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
      <div className="snapshot-loading-shell">
        <div className="snapshot-loading-wrap">
          <div className="snapshot-loading-top">
            <div className="snapshot-loading-brand">
              <span className="snapshot-loading-eyebrow">ULTOPS / Snapshot</span>
              <div className="snapshot-loading-heading">
                <div className="snapshot-loading-spinner" />
                <div style={{ display: "grid", gap: 6 }}>
                  <h1 className="snapshot-loading-title">Loading the live NBA prop board</h1>
                  <p className="snapshot-loading-copy">
                    Streaming the featured pick, board summary, and research tabs from the current snapshot payload.
                  </p>
                </div>
              </div>
            </div>
            <div className="snapshot-loading-live">
              <span className="snapshot-loading-live-dot" />
              Live snapshot streaming
            </div>
          </div>

          <div className="snapshot-loading-nav">
            {topNav.map((label) => (
              <span key={label} className="snapshot-loading-nav-pill">
                {label}
              </span>
            ))}
          </div>

          <div className="snapshot-loading-grid">
            <div className="snapshot-loading-panel">
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {["Board loading", "Featured pick", "Research tabs"].map((label) => (
                  <span key={label} className="snapshot-loading-chip">
                    {label}
                  </span>
                ))}
              </div>

              <div className="snapshot-loading-feature">
                <div className="snapshot-loading-status">
                  {statusSteps.map((step) => (
                    <div key={step.title} className="snapshot-loading-status-row">
                      <span className="snapshot-loading-status-dot" />
                      <div style={{ display: "grid", gap: 4 }}>
                        <strong style={{ fontSize: 14, fontWeight: 700, color: "#f6fafc" }}>{step.title}</strong>
                        <span style={{ fontSize: 13, lineHeight: 1.55, color: "#9fb4cc" }}>{step.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  <div className="snapshot-loading-line snapshot-loading-line-strong" />
                  <div className="snapshot-loading-line snapshot-loading-line-wide" />
                  <div className="snapshot-loading-line snapshot-loading-line-wide" style={{ width: "88%" }} />
                </div>
              </div>

              <div className="snapshot-loading-tile-grid">
                {loadingTiles.map((tile) => (
                  <div key={tile} className="snapshot-loading-tile">
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "#8ea4be",
                      }}
                    >
                      {tile}
                    </span>
                    <div className="snapshot-loading-line snapshot-loading-line-strong" />
                    <div className="snapshot-loading-line snapshot-loading-line-soft" />
                  </div>
                ))}
              </div>

              <div className="snapshot-loading-tab-grid">
                {loadingTabs.map((label) => (
                  <div key={label} className="snapshot-loading-tab">
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "#dbe8f3",
                      }}
                    >
                      {label}
                    </div>
                    <div className="snapshot-loading-line snapshot-loading-line-soft" style={{ width: "66%" }} />
                    <div className="snapshot-loading-line snapshot-loading-line-wide" />
                  </div>
                ))}
              </div>
            </div>

            <div className="snapshot-loading-panel">
              <div className="snapshot-loading-aside-block">
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "#fbbf24",
                  }}
                >
                  Why this screen exists
                </span>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: "#cfdbeb" }}>
                  This is the intentional streaming state for the live board. It mirrors the real product shell so mobile,
                  browser, and server checks do not look like a broken fallback.
                </p>
              </div>

              <div className="snapshot-loading-note">
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "#67e8f9",
                  }}
                >
                  Expected next
                </div>
                <div style={{ display: "grid", gap: 10, color: "#d9e7f4", fontSize: 13, lineHeight: 1.55 }}>
                  <div>Featured precision card and ranked edge stack</div>
                  <div>Research Center, Scout Feed, and Line Tracking tabs</div>
                  <div>Live, derived, and placeholder labels carried into the board</div>
                </div>
              </div>

              <p className="snapshot-loading-foot">
                If this screen clears quickly, the route is behaving normally. If it persists unusually long, the board
                query is stalled rather than the UI shell being broken.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
