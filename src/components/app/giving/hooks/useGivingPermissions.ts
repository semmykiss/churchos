"use client";

/**
 * useGivingPermissions — client mirror of the server's giving grant checks.
 * The SERVER always re-checks (scopeGivingQuery + per-route permissions);
 * this only shapes the UI so members never see staff affordances.
 */
import { useMemo } from "react";
import { canDo, type SessionUser } from "@/lib/types";

export interface GivingPermissions {
  canViewAll: boolean;
  canViewOwn: boolean;
  canGive: boolean;
  canRecord: boolean;
  canReverse: boolean;
  canManageBatches: boolean;
  canManageFunds: boolean;
  canManagePledges: boolean;
  canManageStatements: boolean;
  /** member self-service (own data only) → renders MyGivingPortal */
  isMemberOnly: boolean;
}

export function useGivingPermissions(user: SessionUser | null | undefined): GivingPermissions {
  return useMemo(() => {
    const can = (p: string) => canDo(user ?? null, p);
    const canViewAll = can("giving.view.all");
    const canViewOwn = can("giving.view.own");
    return {
      canViewAll,
      canViewOwn,
      canGive: can("giving.give"),
      canRecord: can("giving.record"),
      canReverse: can("giving.reverse"),
      canManageBatches: can("giving.batches.manage"),
      canManageFunds: can("giving.funds.manage"),
      canManagePledges: can("giving.pledges.manage"),
      canManageStatements: can("giving.statements.manage"),
      isMemberOnly: !canViewAll && canViewOwn,
    };
  }, [user]);
}
