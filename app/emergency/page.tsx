export default function Emergency() {
  return (
    <html>
      <body style={{ margin: 0, padding: '2rem', fontFamily: 'Arial' }}>
        <h1 style={{ color: 'red' }}>🚨 EMERGENCY TEST PAGE</h1>
        <p>If you can see this, Next.js is working.</p>
        <p>Current time: {new Date().toISOString()}</p>
      </body>
    </html>
  )
}