// ChurchOS — Collection Session detail API (count sheets + workflow transitions)
// GET    /api/finance/collection-sessions/[id]   — session + count sheets
// POST   /api/finance/collection-sessions/[id]   — add a count sheet (usher)
// PATCH  /api/finance/collection-sessions/[id]   — transition status (submit/verify/handover/deposit/post)
// DELETE /api/finance/collection-sessions/[id]   — cancel session (finance:manage)
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { postJournal } from '@/lib/finance/accounting'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('finance', 'view')
  const { id } = await params
  const session = await db.collectionSession.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      countSheets: { include: { lines: true } },
    },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ session })
})

// Add a count sheet (one per counter)
export const POST = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('finance', 'create')
  const { id } = await params
  const session = await db.collectionSession.findFirst({
    where: { id, organizationId: ctx.organizationId },
  })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.status !== 'open' && session.status !== 'counted') {
    return NextResponse.json({ error: `Cannot add count sheet to a ${session.status} session.` }, { status: 400 })
  }
  const body = await req.json().catch(() => ({}))
  const { counterName, lines } = body
  if (!counterName || !Array.isArray(lines)) {
    return NextResponse.json({ error: 'counterName and lines[] are required.' }, { status: 400 })
  }
  const totalAmount = lines.reduce((s: number, l: any) => s + (Number(l.amount) || 0), 0)
  const countSheet = await db.countSheet.create({
    data: {
      organizationId: ctx.organizationId,
      sessionId: id,
      counterName: String(counterName),
      counterUserId: ctx.user.id,
      status: 'submitted',
      totalAmount,
      submittedAt: new Date(),
      lines: { create: lines.map((l: any) => ({ category: String(l.category), amount: Number(l.amount) || 0, note: l.note ?? null })) },
    },
  })
  await audit(ctx, 'finance.countsheet.submit', 'countSheet', countSheet.id, { sessionId: id, totalAmount })
  return NextResponse.json(countSheet, { status: 201 })
})

// Transition status: submit → verify → handover → deposit → post
export const PATCH = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('finance', 'update')
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { action } = body
  const session = await db.collectionSession.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { countSheets: { include: { lines: true } } },
  })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  if (action === 'verify') {
    // Verify the session — requires at least one submitted count sheet.
    if (session.countSheets.length === 0) {
      return NextResponse.json({ error: 'Cannot verify a session with no count sheets.' }, { status: 400 })
    }
    const total = session.countSheets.reduce((s, cs) => s + cs.totalAmount, 0)
    await db.collectionSession.update({
      where: { id },
      data: { status: 'verified', verifiedAt: new Date(), totalAmount: total },
    })
    await audit(ctx, 'finance.collection.verify', 'collectionSession', id, { total })
    return NextResponse.json({ ok: true, status: 'verified', totalAmount: total })
  }

  if (action === 'handover') {
    if (session.status !== 'verified') {
      return NextResponse.json({ error: 'Session must be verified before handover.' }, { status: 400 })
    }
    await db.collectionSession.update({
      where: { id },
      data: { status: 'handed_over', handedOverAt: new Date() },
    })
    await audit(ctx, 'finance.collection.handover', 'collectionSession', id, {})
    return NextResponse.json({ ok: true, status: 'handed_over' })
  }

  if (action === 'deposit') {
    if (session.status !== 'handed_over') {
      return NextResponse.json({ error: 'Session must be handed over before deposit.' }, { status: 400 })
    }
    await db.collectionSession.update({
      where: { id },
      data: { status: 'deposited', depositedAt: new Date() },
    })
    await audit(ctx, 'finance.collection.deposit', 'collectionSession', id, {})
    return NextResponse.json({ ok: true, status: 'deposited' })
  }

  if (action === 'post') {
    // Post the collection to the GL. Requires the session to be deposited.
    // Creates a balanced journal entry: debit Cash/Bank, credit each income category.
    if (session.status !== 'deposited') {
      return NextResponse.json({ error: 'Session must be deposited before posting to GL.' }, { status: 400 })
    }
    if (!session.countSheets.length) {
      return NextResponse.json({ error: 'No count sheets to post.' }, { status: 400 })
    }

    // Aggregate amounts by category across all count sheets
    const byCategory = new Map<string, number>()
    for (const cs of session.countSheets) {
      for (const line of cs.lines) {
        byCategory.set(line.category, (byCategory.get(line.category) ?? 0) + line.amount)
      }
    }

    // Map collection categories to income account codes
    const CATEGORY_TO_ACCOUNT: Record<string, string> = {
      tithe: '4000',
      general_offering: '4010',
      thanksgiving: '4020',
      special: '4030',
      building_fund: '4040',
      missions: '4040',
      welfare: '4040',
    }

    // Build journal lines: debit cash (1010), credit each income account
    const total = round(session.totalAmount || Array.from(byCategory.values()).reduce((s, n) => s + n, 0))
    const lines: any[] = [
      { accountCode: '1010', debit: total, credit: 0 }, // Debit Operating Bank
    ]
    for (const [category, amount] of byCategory) {
      const code = CATEGORY_TO_ACCOUNT[category] ?? '4010' // default to General Offerings
      lines.push({ accountCode: code, debit: 0, credit: amount })
    }

    try {
      const entry = await postJournal(ctx, {
        description: `Collection for ${session.sessionDate.toISOString().slice(0, 10)} (session ${id.slice(-6)})`,
        transactionDate: session.sessionDate,
        source: 'collection',
        sourceRefId: id,
        lines,
      })
      await db.collectionSession.update({
        where: { id },
        data: { status: 'posted', postedAt: new Date(), journalEntryId: entry.id },
      })
      await audit(ctx, 'finance.collection.post', 'collectionSession', id, { journalEntryRef: entry.reference })
      return NextResponse.json({ ok: true, status: 'posted', journalEntryRef: entry.reference })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
  }

  if (action === 'cancel') {
    if (session.status === 'posted') {
      return NextResponse.json({ error: 'Cannot cancel a posted session. Reverse the journal entry instead.' }, { status: 400 })
    }
    await db.collectionSession.update({ where: { id }, data: { status: 'cancelled' } })
    await audit(ctx, 'finance.collection.cancel', 'collectionSession', id, {})
    return NextResponse.json({ ok: true, status: 'cancelled' })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
})

function round(n: number): number {
  return Math.round(n * 100) / 100
}

export const DELETE = apiHandler(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requirePermission('finance', 'delete')
  const { id } = await params
  const session = await db.collectionSession.findFirst({ where: { id, organizationId: ctx.organizationId } })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (session.status === 'posted') {
    return NextResponse.json({ error: 'Cannot delete a posted session. Reverse the journal entry instead.' }, { status: 400 })
  }
  await db.collectionSession.update({ where: { id }, data: { status: 'cancelled' } })
  await audit(ctx, 'finance.collection.cancel', 'collectionSession', id, {})
  return NextResponse.json({ ok: true })
})
