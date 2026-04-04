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

const loadingTiles = [
  "Matchups",
  "Live lines",
  "Precision card",
  "Research tabs",
];

export default function Loading(): React.ReactElement {
  return (
    <>
      <style>{`
        @keyframes ultops-spin { to { transform: rotate(360deg); } }
        @keyframes ultops-pulse {
          0%, 100% { opacity: 0.45; transform: scale(0.98); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "32px 20px",
          background:
            "radial-gradient(circle at top, rgba(34, 211, 238, 0.14), transparent 28%), radial-gradient(circle at 82% 18%, rgba(245, 158, 11, 0.12), transparent 24%), linear-gradient(180deg, #050b14 0%, #07111c 45%, #09131b 100%)",
          color: "#f5f7fb",
          fontFamily: '"Segoe UI", sans-serif',
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 1120,
            display: "grid",
            gap: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "grid", gap: 8 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: "#67e8f9",
                }}
              >
                ULTOPS / Snapshot
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 42,
                    height: 42,
                    border: "3px solid rgba(103, 232, 249, 0.18)",
                    borderTop: "3px solid #67e8f9",
                    borderRadius: "50%",
                    animation: "ultops-spin 0.8s linear infinite",
                  }}
                />
                <div style={{ display: "grid", gap: 6 }}>
                  <h1
                    style={{
                      margin: 0,
                      fontSize: "clamp(1.9rem, 3vw, 2.8rem)",
                      fontWeight: 800,
                      lineHeight: 1.05,
                      letterSpacing: "-0.04em",
                    }}
                  >
                    Loading the live NBA prop board
                  </h1>
                  <p
                    style={{
                      margin: 0,
                      maxWidth: 720,
                      fontSize: 15,
                      lineHeight: 1.6,
                      color: "#bfd0e5",
                    }}
                  >
                    Streaming the current slate, featured precision card, and
                    research context from the live snapshot payload.
                  </p>
                </div>
              </div>
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                borderRadius: 999,
                border: "1px solid rgba(103, 232, 249, 0.2)",
                background: "rgba(9, 21, 36, 0.82)",
                color: "#d9f6fb",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: "#22c55e",
                  boxShadow: "0 0 0 6px rgba(34, 197, 94, 0.12)",
                  animation: "ultops-pulse 1.6s ease-in-out infinite",
                }}
              />
              Live snapshot streaming
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.3fr) minmax(320px, 0.9fr)",
              gap: 20,
            }}
          >
            <div
              style={{
                borderRadius: 28,
                border: "1px solid rgba(148, 163, 184, 0.12)",
                background:
                  "linear-gradient(180deg, rgba(9, 16, 29, 0.94), rgba(8, 17, 29, 0.86))",
                padding: 24,
                boxShadow: "0 24px 60px rgba(0, 0, 0, 0.35)",
                display: "grid",
                gap: 18,
              }}
            >
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {["Board loading", "Featured pick", "Research tabs"].map(
                  (label) => (
                    <span
                      key={label}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "8px 12px",
                        borderRadius: 999,
                        background: "rgba(8, 23, 38, 0.9)",
                        border: "1px solid rgba(103, 232, 249, 0.12)",
                        color: "#cfeaf1",
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                      }}
                    >
                      {label}
                    </span>
                  ),
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 12,
                  padding: "18px 18px 16px",
                  borderRadius: 22,
                  background:
                    "linear-gradient(180deg, rgba(12, 23, 38, 0.96), rgba(10, 19, 31, 0.9))",
                  border: "1px solid rgba(148, 163, 184, 0.1)",
                }}
              >
                {statusSteps.map((step) => (
                  <div
                    key={step.title}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "12px minmax(0, 1fr)",
                      gap: 12,
                      alignItems: "start",
                    }}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        marginTop: 5,
                        background:
                          "linear-gradient(135deg, #67e8f9, rgba(245, 158, 11, 0.9))",
                        animation: "ultops-pulse 1.6s ease-in-out infinite",
                      }}
                    />
                    <div style={{ display: "grid", gap: 4 }}>
                      <strong
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: "#f6fafc",
                        }}
                      >
                        {step.title}
                      </strong>
                      <span
                        style={{
                          fontSize: 13,
                          lineHeight: 1.5,
                          color: "#9fb4cc",
                        }}
                      >
                        {step.detail}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: 14,
                }}
              >
                {loadingTiles.map((tile) => (
                  <div
                    key={tile}
                    style={{
                      borderRadius: 20,
                      border: "1px solid rgba(148, 163, 184, 0.1)",
                      background: "rgba(10, 19, 31, 0.9)",
                      padding: 16,
                      display: "grid",
                      gap: 10,
                    }}
                  >
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
                    <div
                      style={{
                        height: 14,
                        width: "72%",
                        borderRadius: 999,
                        background:
                          "linear-gradient(90deg, rgba(103, 232, 249, 0.18), rgba(245, 158, 11, 0.16))",
                        animation: "ultops-pulse 1.4s ease-in-out infinite",
                      }}
                    />
                    <div
                      style={{
                        height: 10,
                        width: "54%",
                        borderRadius: 999,
                        background: "rgba(148, 163, 184, 0.14)",
                        animation: "ultops-pulse 1.8s ease-in-out infinite",
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                borderRadius: 28,
                border: "1px solid rgba(148, 163, 184, 0.12)",
                background:
                  "linear-gradient(180deg, rgba(9, 16, 29, 0.94), rgba(8, 17, 29, 0.86))",
                padding: 24,
                boxShadow: "0 24px 60px rgba(0, 0, 0, 0.32)",
                display: "grid",
                gap: 16,
              }}
            >
              <div style={{ display: "grid", gap: 8 }}>
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
                <p
                  style={{
                    margin: 0,
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: "#cfdbeb",
                  }}
                >
                  This is the intentional streaming state for the live board.
                  If you see it briefly, the route is still building current
                  data from the snapshot payload.
                </p>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 12,
                  padding: 18,
                  borderRadius: 22,
                  border: "1px solid rgba(103, 232, 249, 0.12)",
                  background: "rgba(8, 23, 38, 0.86)",
                }}
              >
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
                <div
                  style={{
                    display: "grid",
                    gap: 10,
                    color: "#d9e7f4",
                    fontSize: 13,
                    lineHeight: 1.55,
                  }}
                >
                  <div>Featured precision card and ranked edge list</div>
                  <div>Research Center, Scout Feed, and Line Tracking tabs</div>
                  <div>Live and derived value labels carried into the board</div>
                </div>
              </div>

              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: "#8ea4be",
                }}
              >
                If this screen persists unusually long, the board query is
                stalled. If it clears quickly, the route is behaving normally.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
