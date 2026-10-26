// Reproduce the access-assignment flow: create user → assign role → verify.
const base = 'http://localhost:3000'
const login = await fetch(`${base}/api/auth`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@gracechapel.org', password: 'churchos123' }),
})
const jwt = (login.headers.get('set-cookie') ?? '').match(/churchos_session=([^;]+)/)?.[1] ?? ''
const H = { 'Content-Type': 'application/json', Cookie: `churchos_session=${jwt}` }
console.log('login:', login.status)

// 1) Create a brand-new user (as admin would in Settings → Users)
const email = `testaccess${Date.now()}@gracechapel.org`
const create = await fetch(`${base}/api/settings/users`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ name: 'Test Access User', email, password: 'churchos123', role: 'member', sendInvite: false }),
})
const created = await create.json()
console.log('1) CREATE USER:', create.status, '→', created?.user?.id ?? JSON.stringify(created).slice(0, 200))
const userId = created?.user?.id ?? created?.id

// 2) Assign a role via the Access module endpoint
if (userId) {
  const assign = await fetch(`${base}/api/access/assign`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ userId, role: 'finance_officer' }),
  })
  console.log('2) ASSIGN ROLE:', assign.status, JSON.stringify(await assign.json()).slice(0, 220))

  // 3) Check the users list shows the new role
  const list = await fetch(`${base}/api/access/users?q=${encodeURIComponent(email)}`, { headers: H })
  const listJson = await list.json()
  console.log('3) USERS LIST:', list.status, '→', JSON.stringify(listJson.users?.map((u: any) => ({ name: u.name, role: u.role, active: u.active }))))
}

// Make this a module: enables top-level await (TS1375) and stops the global
// `login` const from colliding with other non-module scripts (TS2451).
export {}
