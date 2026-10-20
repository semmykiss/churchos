// ChurchOS — demo seed script. Run with: bun run db:seed
// Creates one organization, all role accounts, demo members, departments, services, finance, etc.
// DEMO DATA ONLY — clearly identifiable demo passwords.
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/password'

const db = new PrismaClient()

const DEMO_PASSWORD = 'churchos123'

async function main() {
  console.log('Seeding ChurchOS demo data...')

  const org = await db.organization.upsert({
    where: { slug: 'grace-chapel' },
    update: {},
    create: {
      name: 'Grace Chapel International',
      slug: 'grace-chapel',
      address: '12 Redemption Way, Lagos',
      phone: '+234 801 234 5678',
      email: 'hello@gracechapel.org',
      timezone: 'Africa/Lagos',
      currency: 'NGN',
    },
  })

  const branchMain = await db.branch.upsert({
    where: { id: 'branch-main' },
    update: { organizationId: org.id, name: 'Main Campus — Lagos', location: '12 Redemption Way, Lagos' },
    create: { id: 'branch-main', organizationId: org.id, name: 'Main Campus — Lagos', location: '12 Redemption Way, Lagos' },
  })
  const branchEast = await db.branch.upsert({
    where: { id: 'branch-east' },
    update: { organizationId: org.id, name: 'East Campus — Lekki', location: 'Lekki Phase 1, Lagos' },
    create: { id: 'branch-east', organizationId: org.id, name: 'East Campus — Lekki', location: 'Lekki Phase 1, Lagos' },
  })

  // Departments
  const departments = [
    { id: 'dept-worship', name: 'Worship & Music', color: '#0d9488' },
    { id: 'dept-media', name: 'Media & Technical', color: '#7c3aed' },
    { id: 'dept-ushering', name: 'Ushering & Protocol', color: '#ea580c' },
    { id: 'dept-children', name: 'Children’s Church', color: '#db2777' },
    { id: 'dept-evangelism', name: 'Evangelism & Outreach', color: '#16a34a' },
    { id: 'dept-welfare', name: 'Welfare & Benevolence', color: '#0891b2' },
  ]
  for (const d of departments) {
    await db.department.upsert({
      where: { id: d.id },
      update: { organizationId: org.id, name: d.name, color: d.color },
      create: { id: d.id, organizationId: org.id, name: d.name, color: d.color, description: `${d.name} department` },
    })
  }

  // Demo users for each role
  const passwordHash = hashPassword(DEMO_PASSWORD)
  const users = [
    { id: 'user-admin', name: 'Daniel Okafor', email: 'admin@gracechapel.org', role: 'church_admin', departmentId: null },
    { id: 'user-super', name: 'Platform Admin', email: 'super@churchos.app', role: 'super_admin', departmentId: null },
    { id: 'user-pastor', name: 'Pastor Samuel Adeyemi', email: 'pastor@gracechapel.org', role: 'pastor', departmentId: null },
    { id: 'user-finance', name: 'Grace Eze', email: 'finance@gracechapel.org', role: 'finance_officer', departmentId: null },
    { id: 'user-worship-head', name: 'Michael Bello', email: 'worship@gracechapel.org', role: 'department_head', departmentId: 'dept-worship' },
    { id: 'user-media-head', name: 'Tunde Lawal', email: 'media@gracechapel.org', role: 'department_head', departmentId: 'dept-media' },
    { id: 'user-worship-asst', name: 'Sarah Obi', email: 'assistant@gracechapel.org', role: 'department_assistant', departmentId: 'dept-worship' },
    { id: 'user-member', name: 'John Member', email: 'member@gracechapel.org', role: 'member', departmentId: null },
  ]
  for (const u of users) {
    await db.user.upsert({
      where: { email: u.email },
      update: { passwordHash, name: u.name, role: u.role, departmentId: u.departmentId, organizationId: org.id },
      create: { id: u.id, email: u.email, name: u.name, role: u.role, departmentId: u.departmentId, organizationId: org.id, passwordHash, phone: '+234 800 000 0000' },
    })
  }

  // Assign department heads
  await db.department.update({ where: { id: 'dept-worship' }, data: { headUserId: 'user-worship-head' } })
  await db.department.update({ where: { id: 'dept-media' }, data: { headUserId: 'user-media-head' } })

  // Members
  const firstNames = ['Emmanuel','Blessing','Chidi','Folake','Ibrahim','Aisha','Kunle','Zainab','Tobi','Ngozi','Yusuf','Hauwa','David','Esther','Peter','Mary','James','Ruth','Paul','Hannah','Samuel','Deborah','Joseph','Rebecca','Stephen','Priscilla','Mark','Dorcas','Daniel','Sarah']
  const lastNames = ['Ade','Okafor','Bello','Eze','Lawal','Obi','Mohammed','Olu','Adeyemi','Balogun','Nwosu','Ibrahim','Adewale','Okon','Yusuf','Dauda','Adebayo','Okeke','Chukwu','Salami']
  const statuses = ['active','active','active','visitor','new_convert','follow_up','inactive','active']
  const branches = [branchMain.id, branchEast.id]
  let memberCount = 0
  for (let i = 0; i < 38; i++) {
    const fn = firstNames[i % firstNames.length]
    const ln = lastNames[(i * 3) % lastNames.length]
    const status = statuses[i % statuses.length]
    const baptized = i % 3 === 0
    memberCount++
    const m = await db.member.create({
      data: {
        organizationId: org.id,
        branchId: branches[i % 2],
        memberId: `GCI/${String(1000 + i).padStart(4, '0')}`,
        firstName: fn,
        lastName: ln,
        gender: i % 2 === 0 ? 'male' : 'female',
        dateOfBirth: new Date(1970 + (i % 40), i % 12, (i % 27) + 1),
        phone: `+234 80${i} ${String(1000000 + i)}`,
        email: i % 4 === 0 ? `${fn.toLowerCase()}.${ln.toLowerCase()}@email.com` : null,
        address: `${i} Faith Avenue, Lagos`,
        status,
        isMinor: i % 11 === 0,
        dateJoined: new Date(Date.now() - (i * 86400000 * 12)),
        baptized,
        baptizedDate: baptized ? new Date(Date.now() - i * 86400000 * 30) : null,
        emergencyName: i % 2 === 0 ? `${ln} Family` : null,
        emergencyPhone: `+234 801 ${String(1000000 + i)}`,
        followUpOwnerId: i % 5 === 0 ? 'user-worship-head' : null,
      },
    })
    // assign some members to departments
    const deptAssign = departments[i % departments.length]
    await db.departmentMembership.create({ data: { memberId: m.id, departmentId: deptAssign.id, role: i % 7 === 0 ? 'leader' : 'member' } }).catch(() => {})
  }
  console.log(`Created ${memberCount} members`)

  // Services + attendance sessions
  const services = [
    { id: 'svc-sunday-1', name: 'Sunday First Service', serviceType: 'sunday_worship', dayOfWeek: 0, startTime: '07:30', endTime: '09:30', branchId: branchMain.id },
    { id: 'svc-sunday-2', name: 'Sunday Second Service', serviceType: 'sunday_worship', dayOfWeek: 0, startTime: '10:00', endTime: '12:00', branchId: branchMain.id },
    { id: 'svc-wednesday', name: 'Midweek Bible Study', serviceType: 'bible_study', dayOfWeek: 3, startTime: '18:00', endTime: '19:30', branchId: branchMain.id },
    { id: 'svc-friday', name: 'Friday Prayer Night', serviceType: 'prayer', dayOfWeek: 5, startTime: '18:30', endTime: '20:30', branchId: branchEast.id },
  ]
  for (const s of services) {
    await db.service.upsert({
      where: { id: s.id },
      update: {},
      create: { id: s.id, organizationId: org.id, ...s },
    })
  }

  // Attendance for the last 6 Sundays
  const allMembers = await db.member.findMany({ where: { organizationId: org.id } })
  for (let w = 5; w >= 0; w--) {
    const date = new Date()
    date.setDate(date.getDate() - date.getDay() - w * 7) // previous Sundays
    for (const svc of [services[0], services[1]]) {
      const session = await db.attendanceSession.create({ data: { serviceId: svc.id, branchId: svc.branchId!, date } })
      const present = allMembers.filter(() => Math.random() < 0.6).slice(0, 24)
      for (const m of present) {
        await db.attendanceRecord.create({ data: { sessionId: session.id, memberId: m.id, checkInMethod: Math.random() > 0.5 ? 'qr' : 'manual' } }).catch(() => {})
      }
    }
  }

  // Visitors & follow-up
  const visitorSources = ['Friend', 'Flyer', 'Social Media', 'Walk-in', 'Outreach']
  for (let i = 0; i < 8; i++) {
    const v = await db.visitor.create({
      data: {
        organizationId: org.id,
        firstName: `Visitor${i + 1}`,
        lastName: 'Guest',
        phone: `+234 803 ${String(2000000 + i)}`,
        email: i % 2 === 0 ? `visitor${i + 1}@email.com` : null,
        referralSource: visitorSources[i % visitorSources.length],
        consent: true,
      },
    })
    await db.followUpTask.create({
      data: {
        organizationId: org.id,
        visitorId: v.id,
        ownerId: 'user-worship-head',
        status: i < 3 ? 'done' : i < 6 ? 'in_progress' : 'pending',
        dueDate: new Date(Date.now() + (i - 3) * 86400000),
        notes: i % 2 === 0 ? 'Called and prayed with visitor' : 'Attempted contact',
      },
    })
  }

  // Events
  const now = new Date()
  const events = [
    { title: 'Easter Celebration Service', eventType: 'special', venue: 'Main Auditorium', capacity: 1500, startDate: new Date(now.getFullYear(), 2, 30, 10, 0), status: 'scheduled' },
    { title: 'Youth Camp 2025', eventType: 'retreat', venue: 'Redemption Camp', capacity: 300, startDate: new Date(now.getFullYear(), 6, 15, 9, 0), endDate: new Date(now.getFullYear(), 6, 19, 18, 0), status: 'scheduled' },
    { title: 'Marriage Seminar', eventType: 'conference', venue: 'Hall B', capacity: 200, startDate: new Date(now.getTime() + 14 * 86400000), status: 'approved' },
    { title: 'Evangelism Outreach — Lekki', eventType: 'outreach', venue: 'Lekki Phase 1', startDate: new Date(now.getTime() + 7 * 86400000), status: 'scheduled', departmentId: 'dept-evangelism' },
    { title: 'Worship Team Rehearsal', eventType: 'training', venue: 'Music Room', startDate: new Date(now.getTime() + 2 * 86400000), status: 'scheduled', departmentId: 'dept-worship' },
  ]
  for (const e of events) {
    const created = await db.event.create({
      data: { organizationId: org.id, createdBy: 'user-admin', ...e },
    })
    // a few registrations
    for (let r = 0; r < (e.capacity ? Math.min(e.capacity, 12) : 5); r++) {
      await db.registration.create({
        data: { eventId: created.id, name: `${firstNames[r]} ${lastNames[r]}`, email: `reg${r}@email.com`, phone: `+234 80${r} ${String(3000000 + r)}` },
      }).catch(() => {})
    }
  }

  // Finance: funds, donations, expenses, budgets
  const funds = [
    { id: 'fund-tithe', name: 'Tithes', code: 'TIT', balance: 0 },
    { id: 'fund-offering', name: 'General Offering', code: 'OFF', balance: 0 },
    { id: 'fund-building', name: 'Building Fund', code: 'BLD', balance: 0 },
    { id: 'fund-missions', name: 'Missions', code: 'MIS', balance: 0 },
  ]
  for (const f of funds) {
    await db.fund.upsert({ where: { id: f.id }, update: {}, create: { id: f.id, organizationId: org.id, name: f.name, code: f.code, balance: f.balance } })
  }

  // Donations over last 90 days
  const methods = ['cash', 'transfer', 'card', 'online']
  for (let d = 0; d < 60; d++) {
    const date = new Date(now.getTime() - d * 86400000)
    const count = 1 + Math.floor(Math.random() * 5)
    for (let i = 0; i < count; i++) {
      const fund = funds[Math.floor(Math.random() * funds.length)]
      const member = allMembers[Math.floor(Math.random() * allMembers.length)]
      const amount = [5000, 10000, 20000, 50000, 100000, 200000, 5000, 1000][Math.floor(Math.random() * 8)]
      await db.donation.create({
        data: {
          organizationId: org.id,
          fundId: fund.id,
          memberId: member.id,
          donorName: `${member.firstName} ${member.lastName}`,
          amount,
          currency: 'NGN',
          method: methods[Math.floor(Math.random() * methods.length)],
          reference: `TXN-${date.getTime()}-${i}`,
          status: Math.random() > 0.05 ? 'confirmed' : 'pending',
          donatedAt: date,
        },
      })
    }
  }

  // Expenses
  const expenseCats = ['Utilities', 'Maintenance', 'Salaries', 'Outreach', 'Equipment', 'Office Supplies']
  for (let i = 0; i < 24; i++) {
    await db.expense.create({
      data: {
        organizationId: org.id,
        fundId: funds[i % funds.length].id,
        category: expenseCats[i % expenseCats.length],
        description: `${expenseCats[i % expenseCats.length]} — ${['Jan','Feb','Mar','Apr'][i % 4]}`,
        amount: [15000, 45000, 120000, 80000, 23000, 7500, 200000][i % 7],
        payee: ['NEPA', 'FixIt Ltd', 'Staff Payroll', 'Outreach Team', 'TechHub', 'Office Depot'][i % 6],
        method: ['cash', 'transfer'][i % 2],
        status: i % 3 === 0 ? 'pending' : i % 3 === 1 ? 'approved' : 'paid',
        incurredAt: new Date(now.getTime() - i * 3 * 86400000),
      },
    })
  }

  // Budgets
  for (const f of funds) {
    await db.budget.create({ data: { organizationId: org.id, fundId: f.id, fiscalYear: now.getFullYear(), period: 'annual', amount: 5_000_000 } })
  }

  // Recompute fund balances from donations - expenses (confirmed) so dashboards show real numbers
  for (const f of funds) {
    const inc = await db.donation.aggregate({ where: { fundId: f.id, status: 'confirmed' }, _sum: { amount: true } })
    const exp = await db.expense.aggregate({ where: { fundId: f.id, status: { in: ['approved', 'paid'] } }, _sum: { amount: true } })
    await db.fund.update({ where: { id: f.id }, data: { balance: (inc._sum.amount ?? 0) - (exp._sum.amount ?? 0) } })
  }

  // Announcements
  const announcements = [
    { title: 'Welcome to Grace Chapel', body: 'We are glad you are here. Join us this Sunday for a powerful time of worship and the word.', audience: 'all', pinned: true },
    { title: 'Midweek Bible Study', body: 'Join us every Wednesday at 6:00 PM for an in-depth study of the scriptures.', audience: 'members' },
    { title: 'Youth Camp Registration Open', body: 'Registration for Youth Camp 2025 is now open. See the Events page.', audience: 'all' },
    { title: 'Worship Team Rehearsal', body: 'All worship team members: rehearsal on Saturday by 4 PM.', audience: 'department', departmentId: 'dept-worship' },
  ]
  for (const a of announcements) {
    await db.announcement.create({ data: { organizationId: org.id, ...a } })
  }

  // Tasks
  const tasks = [
    { title: 'Prepare Sunday bulletin', status: 'todo', priority: 'high', departmentId: 'dept-media', dueDate: new Date(now.getTime() + 2 * 86400000) },
    { title: 'Audit sound equipment', status: 'in_progress', priority: 'normal', departmentId: 'dept-media', dueDate: new Date(now.getTime() + 5 * 86400000) },
    { title: 'Rehearse new worship song', status: 'todo', priority: 'normal', departmentId: 'dept-worship', dueDate: new Date(now.getTime() + 3 * 86400000) },
    { title: 'Visit new converts', status: 'in_progress', priority: 'high', departmentId: 'dept-evangelism', dueDate: new Date(now.getTime() + 7 * 86400000) },
    { title: 'Stock welfare pantry', status: 'done', priority: 'normal', departmentId: 'dept-welfare' },
    { title: 'Plan Easter program', status: 'todo', priority: 'urgent', dueDate: new Date(now.getTime() + 10 * 86400000) },
  ]
  for (const t of tasks) {
    await db.task.create({ data: { organizationId: org.id, ...t } })
  }

  // Assets
  const assets = [
    { name: 'Yamaha PSR-S975 Keyboard', category: 'instrument', location: 'Stage', custodian: 'Worship Dept', condition: 'good', value: 850000 },
    { name: 'Allen & Heath Mixer', category: 'equipment', location: 'Sound Booth', custodian: 'Media Dept', condition: 'good', value: 600000 },
    { name: 'Canon EOS R6 Camera', category: 'equipment', location: 'Media Office', custodian: 'Media Dept', condition: 'good', value: 1_500_000 },
    { name: 'Toyota HiAce Bus', category: 'vehicle', location: 'Parking Lot', custodian: 'Transport', condition: 'fair', value: 8_000_000 },
    { name: 'Projector — Main Hall', category: 'equipment', location: 'Main Hall', custodian: 'Media Dept', condition: 'fair', value: 350000 },
    { name: 'Folding Chairs (200x)', category: 'furniture', location: 'Store Room', custodian: 'Ushering', condition: 'good', value: 400000 },
    { name: 'Dell Server', category: 'it', location: 'Server Room', custodian: 'IT', condition: 'good', value: 1_200_000 },
  ]
  for (const a of assets) {
    await db.asset.create({ data: { organizationId: org.id, tag: `GCI-AST-${Math.floor(Math.random() * 9000 + 1000)}`, ...a, acquiredAt: new Date(now.getTime() - Math.random() * 365 * 86400000) } })
  }

  // Documents
  const docs = [
    { title: 'Child Protection Policy', category: 'policy', accessLevel: 'staff' },
    { title: 'Volunteer Code of Conduct', category: 'policy', accessLevel: 'members' },
    { title: 'Service Order Template', category: 'template', accessLevel: 'leaders' },
    { title: 'Q1 Finance Report', category: 'report', accessLevel: 'finance' },
    { title: 'Welcome Booklet', category: 'resource', accessLevel: 'public' },
    { title: 'Annual Report 2024', category: 'report', accessLevel: 'staff' },
  ]
  for (const d of docs) {
    await db.document.create({ data: { organizationId: org.id, ...d, description: `${d.title} — ChurchOS document library` } })
  }

  // Pastoral cases
  const caseTypes = ['prayer', 'counselling', 'visitation', 'bereavement', 'welfare']
  for (let i = 0; i < 6; i++) {
    await db.pastoralCase.create({
      data: {
        organizationId: org.id,
        memberId: allMembers[i % allMembers.length].id,
        type: caseTypes[i % caseTypes.length],
        status: i < 2 ? 'open' : i < 4 ? 'in_progress' : 'resolved',
        priority: ['low', 'normal', 'high', 'urgent'][i % 4],
        assignedToId: 'user-pastor',
        description: 'Confidential pastoral case — restricted access.',
      },
    })
  }
  // Prayer requests
  for (let i = 0; i < 5; i++) {
    await db.prayerRequest.create({
      data: {
        organizationId: org.id,
        memberId: allMembers[i].id,
        name: `${allMembers[i].firstName} ${allMembers[i].lastName}`,
        request: ['Pray for healing', 'Pray for family', 'Pray for job', 'Pray for peace', 'Thanksgiving'][i],
        private: i % 2 === 0,
      },
    })
  }

  // Some audit log entries
  for (let i = 0; i < 4; i++) {
    await db.auditLog.create({
      data: {
        organizationId: org.id,
        actorId: 'user-admin',
        action: ['members.create', 'finance.export', 'settings.update', 'members.update'][i],
        targetType: ['member', 'donation', 'setting', 'member'][i],
      },
    })
  }

  console.log('Seed complete.')
  console.log('Demo login credentials (password: churchos123):')
  console.log('  admin@gracechapel.org        — Church Admin')
  console.log('  pastor@gracechapel.org       — Pastor')
  console.log('  finance@gracechapel.org      — Finance Officer')
  console.log('  worship@gracechapel.org      — Department Head (Worship)')
  console.log('  assistant@gracechapel.org    — Department Assistant')
  console.log('  member@gracechapel.org       — Member')
  console.log('  super@churchos.app           — Super Admin')
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
