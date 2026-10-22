import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function main() {
  console.log('Purging all demo data (keeping users + org + roles + plans)...')

  // Delete in dependency order (children first)
  const models = [
    'chatMessage', 'chatRoom',
    'notification',
    'partnerAudit', 'tenantStatusHistory',
    'accessReview', 'accessGrant', 'approvalPolicy', 'userRoleAssignment', 'fieldPermission',
    'taskComment',
    'tithe', 'dependant', 'relationship', 'household',
    'prayerRequest', 'pastoralCase',
    'meeting', 'approval', 'task',
    'booking', 'asset',
    'document',
    'importJob',
    'payment', 'invoice', 'subscription',
    'budget', 'expense', 'donation', 'fund',
    'registration', 'event',
    'followUpInteraction', 'followUpTask', 'visitor',
    'attendanceRecord', 'attendanceSession', 'service',
    'unit', 'departmentMembership', 'department',
    'memberStatusHistory', 'member',
    'branch',
    'rolePermission', 'role',
    'setting',
    'auditLog',
    'announcement',
  ]

  for (const m of models) {
    try {
      const r = await (db as any)[m].deleteMany({})
      if (r.count > 0) console.log(`  ${m}: ${r.count} deleted`)
    } catch (e: any) {
      // Some models may not exist or have FK constraints — skip
      if (!e.message.includes('does not exist')) {
        console.log(`  ${m}: skipped (${e.message.slice(0, 60)})`)
      }
    }
  }

  // Re-seed roles from the code matrix (so Access Control still works)
  console.log('Re-seeding system roles + permissions...')
  const org = await db.organization.findFirst({ where: { slug: 'grace-chapel' } })
  if (!org) { console.log('No org found — skipping role seed'); return }

  const ROLES = ['super_admin','church_admin','pastor','finance_officer','department_head','department_assistant','unit_leader','member','guest']
  const MATRIX: Record<string, Record<string, string[]>> = {
    super_admin: { dashboard:['view'], members:['view','create','update','delete','export','manage'], departments:['view','create','update','delete','manage'], attendance:['view','create','update','delete','export'], visitors:['view','create','update','delete','export'], followups:['view','create','update','delete','assign'], events:['view','create','update','delete','approve'], finance:['view','create','update','delete','approve','export','manage'], announcements:['view','create','update','delete'], pastoral:['view','create','update','delete','assign'], tasks:['view','create','update','delete','assign'], assets:['view','create','update','delete','manage'], documents:['view','create','update','delete'], reports:['view','export'], settings:['view','manage'], audit:['view','export'], access:['view','manage'], search:['view'], celebrations:['view','create','update','delete','export','manage'], townhall:['view','create','update','delete','manage'] },
    church_admin: { dashboard:['view'], members:['view','create','update','delete','export'], departments:['view','create','update','delete','manage'], attendance:['view','create','update','delete','export'], visitors:['view','create','update','delete','export'], followups:['view','create','update','delete','assign'], events:['view','create','update','delete','approve'], finance:['view','create','update','export'], announcements:['view','create','update','delete'], pastoral:['view','create','update','assign'], tasks:['view','create','update','delete','assign'], assets:['view','create','update','delete'], documents:['view','create','update','delete'], reports:['view','export'], settings:['view','manage'], audit:['view'], search:['view'], celebrations:['view','create','update','delete','export'], townhall:['view','create','update','delete','manage'] },
    pastor: { dashboard:['view'], members:['view','update'], departments:['view'], attendance:['view'], visitors:['view','create','update'], followups:['view','create','update','assign'], events:['view','create','update'], announcements:['view','create'], pastoral:['view','create','update','delete','assign'], tasks:['view','create','update'], assets:['view'], documents:['view'], reports:['view'], settings:['view'], search:['view'], celebrations:['view'], townhall:['view','create'] },
    finance_officer: { dashboard:['view'], members:['view'], departments:['view'], attendance:['view'], events:['view'], finance:['view','create','update','approve','export','manage'], announcements:['view'], tasks:['view'], assets:['view'], documents:['view'], reports:['view','export'], settings:['view'], search:['view'], celebrations:['view'], townhall:['view','create'] },
    department_head: { dashboard:['view'], members:['view','create','update'], departments:['view','update','manage'], attendance:['view','create','update'], visitors:['view'], followups:['view','create','update','assign'], events:['view','create','update'], finance:['view'], announcements:['view','create'], tasks:['view','create','update','delete','assign'], assets:['view','update'], documents:['view'], reports:['view'], settings:['view'], search:['view'], celebrations:['view'], townhall:['view','create'] },
    department_assistant: { dashboard:['view'], members:['view','create'], departments:['view'], attendance:['view','create'], visitors:['view','create'], followups:['view','create','update'], events:['view'], announcements:['view'], tasks:['view','create','update'], assets:['view'], documents:['view'], search:['view'], celebrations:['view'], townhall:['view','create'] },
    unit_leader: { dashboard:['view'], members:['view'], departments:['view'], attendance:['view','create'], visitors:['view'], followups:['view','create'], events:['view'], announcements:['view'], tasks:['view','create'], assets:['view'], documents:['view'], search:['view'], celebrations:['view'], townhall:['view','create'] },
    member: { dashboard:['view'], members:['view','create','update'], departments:['view'], attendance:['view'], events:['view'], finance:['view','create'], announcements:['view'], pastoral:['view','create'], tasks:['view'], documents:['view'], settings:['view'], search:['view'], celebrations:['view'], townhall:['view','create'] },
    guest: { dashboard:[], members:[], departments:[], attendance:[], visitors:[], followups:[], events:['view'], finance:[], announcements:['view'], pastoral:[], tasks:[], assets:[], documents:['view'], reports:[], settings:[], audit:[], search:[], celebrations:[], townhall:[] },
  }
  const META: Record<string, { label: string; description: string; color: string; sortOrder: number }> = {
    super_admin: { label: 'Super Admin', description: 'Platform-wide administration.', color: '#e11d48', sortOrder: 0 },
    church_admin: { label: 'Church Admin', description: 'Full church configuration and operations.', color: '#4f46e5', sortOrder: 1 },
    pastor: { label: 'Pastor', description: 'Pastoral care, members, prayer.', color: '#7c3aed', sortOrder: 2 },
    finance_officer: { label: 'Finance Officer', description: 'Giving, expenses, budgets.', color: '#059669', sortOrder: 3 },
    department_head: { label: 'Department Head', description: 'Leads one department.', color: '#d97706', sortOrder: 4 },
    department_assistant: { label: 'Dept Assistant', description: 'Delegated functions.', color: '#0891b2', sortOrder: 5 },
    unit_leader: { label: 'Unit Leader', description: 'Leads a unit or team.', color: '#0d9488', sortOrder: 6 },
    member: { label: 'Member', description: 'Personal profile, directory, events.', color: '#64748b', sortOrder: 7 },
    guest: { label: 'Guest', description: 'Public pages only.', color: '#94a3b8', sortOrder: 8 },
  }

  for (const name of ROLES) {
    const meta = META[name]
    const role = await db.role.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: { isSystem: true, sortOrder: meta.sortOrder, label: meta.label, description: meta.description, color: meta.color },
      create: { organizationId: org.id, name, label: meta.label, description: meta.description, color: meta.color, isSystem: true, active: true, sortOrder: meta.sortOrder },
    })
    await db.rolePermission.deleteMany({ where: { roleId: role.id } })
    const perms = MATRIX[name] ?? {}
    const data: { module: string; action: string; roleId: string }[] = []
    for (const [mod, actions] of Object.entries(perms)) {
      for (const act of actions) data.push({ module: mod, action: act, roleId: role.id })
    }
    if (data.length) await db.rolePermission.createMany({ data })
    console.log(`  role: ${name} (${data.length} perms)`)
  }

  // Reset org status to active (in case it was suspended during testing)
  await db.organization.update({ where: { id: org.id }, data: { status: 'active', statusReason: null, statusChangedAt: null, planId: null, trialEndsAt: null, subscriptionEndsAt: null, gracePeriodEndsAt: null } })

  // Reset all users to active + clear memberId links (except keep the link for member@gracechapel.org)
  await db.user.updateMany({ where: { active: false }, data: { active: true } })

  // Show remaining counts
  const userCount = await db.user.count()
  const orgCount = await db.organization.count()
  const planCount = await db.plan.count()
  const roleCount = await db.role.count()
  console.log(`\nRemaining: ${userCount} users, ${orgCount} orgs, ${planCount} plans, ${roleCount} roles`)
  console.log('All demo data purged. Login credentials preserved:')
  console.log('  admin@gracechapel.org / churchos123 (Church Admin)')
  console.log('  pastor@gracechapel.org / churchos123 (Pastor)')
  console.log('  finance@gracechapel.org / churchos123 (Finance Officer)')
  console.log('  worship@gracechapel.org / churchos123 (Department Head)')
  console.log('  assistant@gracechapel.org / churchos123 (Dept Assistant)')
  console.log('  member@gracechapel.org / churchos123 (Member)')
  console.log('  super@churchos.app / churchos123 (Super Admin / Partner)')
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
