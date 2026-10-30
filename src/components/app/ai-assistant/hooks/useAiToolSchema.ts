"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AiInfoResp } from "../types";

/**
 * Fetches the permission-filtered tool list for the CURRENT user. The server
 * re-validates every call regardless of what this returns — the client copy
 * only drives transparency chips and suggested prompts.
 */
export function useAiToolSchema(enabled: boolean) {
  return useQuery<AiInfoResp>({
    queryKey: ["ai", "info"],
    queryFn: () => api.get<AiInfoResp>("/ai/info"),
    enabled,
    staleTime: 60_000,
  });
}
