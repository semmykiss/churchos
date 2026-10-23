'use client'

import { useEffect } from 'react'
import { useAuth } from '@/lib/auth-store'

/**
 * Watches `detailRef` from the auth store and invokes `onOpen(refId, action)`
 * when `detailRef.module` matches `moduleName`. Clears the detailRef after
 * handling so it doesn't re-trigger on re-render.
 *
 * Used by module components to open a specific record (member profile, event
 * detail, townhall room, task, tithe, pastoral case, announcement, etc.) when
 * the user clicks a notification that links to it.
 *
 * Usage:
 *   useDetailNav('townhall', (roomId) => setActiveRoomId(roomId))
 */
export function useDetailNav(
  moduleName: string,
  onOpen: (refId: string, action?: string) => void,
) {
  const { detailRef, clearDetail } = useAuth()
  useEffect(() => {
    if (!detailRef || detailRef.module !== moduleName) return
    onOpen(detailRef.refId, detailRef.action)
    clearDetail()
  }, [detailRef?.nonce, clearDetail])
}
