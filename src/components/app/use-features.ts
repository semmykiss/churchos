"use client";

/**
 * Client reader for the per-church feature flags (GET /features).
 * While the flags are loading the map is `undefined` — callers should treat
 * that as "flag on" (flags ship enabled; an owner turning one off flips it
 * within one page load).
 */
import { useApiQuery } from "@/components/app/shared";

export function useFeatures(): Record<string, boolean> | undefined {
  const q = useApiQuery<Record<string, boolean>>(["features"], "/features", {
    staleTime: 60_000,
  });
  return q.data;
}
