// ChurchOS — formatting & currency helpers (timezone Africa/Lagos, currency NGN default)
export function formatCurrency(amount: number | null | undefined, currency = 'NGN'): string {
  if (amount == null || isNaN(amount)) return '—'
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(0)}`
  }
}

export function formatDate(date: Date | string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    timeZone: 'Africa/Lagos',
    ...opts,
  }).format(d)
}

export function formatDateTime(date: Date | string | null | undefined): string {
  return formatDate(date, { hour: '2-digit', minute: '2-digit' })
}

export function relativeTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = d.getTime() - Date.now()
  const abs = Math.abs(diff)
  const min = 60_000, hr = 60 * min, day = 24 * hr
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (abs < hr) return rtf.format(Math.round(diff / min), 'minute')
  if (abs < day) return rtf.format(Math.round(diff / hr), 'hour')
  if (abs < 30 * day) return rtf.format(Math.round(diff / day), 'day')
  return formatDate(d)
}

export function initials(first?: string | null, last?: string | null): string {
  return `${(first || '').charAt(0)}${(last || '').charAt(0)}`.toUpperCase() || '?'
}

export function fullName(first?: string | null, last?: string | null, preferred?: string | null): string {
  if (preferred) return preferred
  return [first, last].filter(Boolean).join(' ') || 'Unknown'
}

export function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
