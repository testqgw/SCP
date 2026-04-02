export default function Loading(): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, rgba(88, 166, 255, 0.12), transparent 28%), radial-gradient(circle at 80% 20%, rgba(139, 92, 246, 0.08), transparent 24%), linear-gradient(180deg, #07111f 0%, #08121d 45%, #09131b 100%)",
        color: "#f5f7fb",
        fontFamily: '"Segoe UI", sans-serif',
        gap: "1.25rem",
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          border: "3px solid rgba(88, 166, 255, 0.18)",
          borderTop: "3px solid #58a6ff",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <p
        style={{
          margin: 0,
          fontSize: "0.85rem",
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#c9d4e3",
        }}
      >
        Loading board...
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
