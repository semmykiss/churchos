// Stress test the local /api/ai/chat endpoint — count 1214 failures.
const login = await fetch('http://localhost:3000/api/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@gracechapel.org', password: 'churchos123' }),
})
const setCookie = login.headers.get('set-cookie') ?? ''
const session = (setCookie.match(/churchos_session=([^;]+)/) ?? [])[1] ?? ''
console.log('login:', login.status, 'session found:', !!session)

let ok = 0, fail = 0
const errors: string[] = []
for (let i = 0; i < 8; i++) {
  try {
    const res = await fetch('http://localhost:3000/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `churchos_session=${session}` },
      body: JSON.stringify({ conversationId: `stress-${Date.now()}-${i}`, message: 'How many members do we have?' }),
    })
    const text = await res.text()
    const hasError = text.includes('"type":"error"')
    const done = text.includes('"type":"done"')
    if (hasError) {
      fail++
      const eMatch = text.match(/"message":"([^"]{0,160})/)
      errors.push(eMatch?.[1] ?? 'unknown')
      console.log(`#${i} FAIL (${res.status})`)
    } else if (done) {
      ok++
      console.log(`#${i} ok (${res.status}, ${text.length} bytes)`)
    } else {
      fail++
      console.log(`#${i} INCOMPLETE (${res.status}) — last 200:`, text.slice(-200))
    }
  } catch (e: any) {
    fail++
    console.log(`#${i} THROW: ${String(e?.message ?? e).slice(0, 120)}`)
  }
}
console.log(`\nRESULT: ${ok} ok / ${fail} fail of 8`)
if (errors.length) console.log('errors:', errors.slice(0, 3))

// Make this a module: enables top-level await (TS1375) and stops the global
// `login` const from colliding with other non-module scripts (TS2451).
export {}
