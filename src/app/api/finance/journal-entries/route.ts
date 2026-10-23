// ChurchOS — Journal Entries API (double-entry accounting)
// GET   /api/finance/journal-entries          — list entries (finance:view)
// POST  /api/finance/journal-entries          — post a balanced journal entry (finance:manage)
//
// Enforces: balanced debits=credits, valid account codes, posting accounts only,
// period-close protection, unique reference, atomic transaction.
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, audit, apiHandler } from '@/lib/api'
import { postJournal, reverseJournal } from '@/lib/finance/accounting'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'view')
  const sp = req.nextUrl.searchParams
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50))
  const entries = await db.journalEntry.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { transactionDate: 'desc' },
    take: limit,
    include: {
      ledgerEntries: {
        include: { account: { select: { code: true, name: true, accountType: true } } },
      },
    },
  })
  return NextResponse.json({ entries })
})

export const POST = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'manage')
  const body = await req.json().catch(() => ({}))
  const { description, transactionDate, source, sourceRefId, lines } = body
  if (!description || !transactionDate || !Array.isArray(lines) || lines.length < 2) {
    return NextResponse.json(
      { error: 'description, transactionDate, and at least 2 lines are required.' },
      { status: 400 },
    )
  }
  try {
    const entry = await postJournal(ctx, {
      description: String(description),
      transactionDate: new Date(transactionDate),
      source: source ?? 'manual',
      sourceRefId: sourceRefId ?? undefined,
      lines,
    })
    await audit(ctx, 'finance.journal.post', 'journalEntry', entry.id, {
      reference: entry.reference,
      source: source ?? 'manual',
      lineCount: lines.length,
    })
    return NextResponse.json(entry, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 })
  }
})

// PATCH — reverse a journal entry (creates a reversing entry, original is never mutated)
export const PATCH = apiHandler(async (req: NextRequest) => {
  const ctx = await requirePermission('finance', 'manage')
  const body = await req.json().catch(() => ({}))
  const { reference, reason, action } = body
  if (action !== 'reverse' || !reference || !reason) {
    return NextResponse.json({ error: 'action=reverse, reference, and reason are required.' }, { status: 400 })
  }
  try {
    const { reversedRef } = await reverseJournal(ctx, String(reference), String(reason))
    await audit(ctx, 'finance.journal.reverse', 'journalEntry', reference, { reversedRef, reason })
    return NextResponse.json({ ok: true, reversedRef })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 })
  }
})
