"use client";

/**
 * GroupPicker — inline group memberships for a person with an add/remove
 * popover flow. Adding or removing a leader requires an AlertDialog confirm.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, X } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useApiQuery } from "@/components/app/shared";
import { api, ApiError, qs } from "@/lib/api";
import { cn } from "@/lib/utils";
import { type Paged } from "@/lib/types";

interface GroupSearchItem {
  id: string;
  name: string;
  type: string;
  memberCount: number;
}

const GROUP_ROLES = ["member", "leader", "apprentice"] as const;

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function GroupPicker({ personId, groups, canManage, onChanged }: {
  personId: string;
  groups: { id: string; name: string; role: string }[];
  canManage: boolean;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const q = useDebounced(searchText);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<{ groupId: string; role: string } | null>(null);
  const [leaderConfirm, setLeaderConfirm] = useState<{ groupId: string; groupName: string; role: string } | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<{ groupId: string; groupName: string } | null>(null);

  const groupsQ = useApiQuery<Paged<GroupSearchItem>>(
    ["groups", "search", { q }],
    `/groups${qs({ search: q || undefined, pageSize: 50 })}`,
    { enabled: open },
  );

  const memberIds = new Set(groups.map((g) => g.id));
  const available = (groupsQ.data?.items ?? []).filter((g) => !memberIds.has(g.id));

  async function addToGroup(groupId: string, groupName: string, role: string) {
    setBusy(true);
    try {
      await api.post(`/people/${personId}/groups`, { groupId, role });
      toast.success(`Added to ${groupName} as ${role}`);
      setExpanded(null);
      setLeaderConfirm(null);
      onChanged?.();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeFromGroup(groupId: string, groupName: string) {
    setBusy(true);
    try {
      await api.del(`/people/${personId}/groups/${groupId}`);
      toast.success(`Removed from ${groupName}`);
      setRemoveConfirm(null);
      onChanged?.();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {groups.map((g) => (
          <Badge key={g.id} variant="secondary" className="gap-1 font-normal">
            {g.name} · <span className="capitalize">{g.role}</span>
            {canManage ? (
              <button
                type="button"
                aria-label={`Remove ${g.name} (${g.role})`}
                className="-mr-1 rounded-full p-0.5 transition-colors hover:bg-foreground/10"
                onClick={() =>
                  g.role === "leader"
                    ? setRemoveConfirm({ groupId: g.id, groupName: g.name })
                    : void removeFromGroup(g.id, g.name)
                }
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            ) : null}
          </Badge>
        ))}
        {groups.length === 0 && !canManage ? <span className="text-sm text-muted-foreground">Not in any group</span> : null}
      </div>

      {canManage ? (
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) {
              setSearchText("");
              setExpanded(null);
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-6 gap-1 rounded-full px-2 text-[11px]">
              <Plus className="h-3 w-3" aria-hidden /> Add to group
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 space-y-2 p-2">
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <Input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search groups…"
                className="h-8"
                aria-label="Search groups"
              />
            </div>
            <ul className="max-h-48 space-y-0.5 overflow-y-auto scroll-slim rounded-md border p-1" aria-label="Group results">
              {groupsQ.isLoading ? (
                <li className="px-2 py-3 text-center text-xs text-muted-foreground">Loading…</li>
              ) : available.length === 0 ? (
                <li className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {searchText.trim() ? "No matches." : "No groups found."}
                </li>
              ) : (
                available.map((g) => {
                  const isExpanded = expanded?.groupId === g.id;
                  return (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => setExpanded(isExpanded ? null : { groupId: g.id, role: "member" })}
                        aria-pressed={isExpanded}
                        className={cn(
                          "row-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                          isExpanded && "bg-primary/15",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{g.name}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
                          </span>
                        </span>
                      </button>
                      {isExpanded ? (
                        <div className="mb-1 mt-1.5 flex items-center gap-2 px-1">
                          <Select
                            value={expanded.role}
                            onValueChange={(v) => setExpanded({ groupId: g.id, role: v })}
                          >
                            <SelectTrigger className="h-8 w-36" aria-label={`Role in ${g.name}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {GROUP_ROLES.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {r.charAt(0).toUpperCase() + r.slice(1)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            size="sm"
                            className="h-8"
                            disabled={busy}
                            onClick={() =>
                              expanded.role === "leader"
                                ? setLeaderConfirm({ groupId: g.id, groupName: g.name, role: expanded.role })
                                : void addToGroup(g.id, g.name, expanded.role)
                            }
                          >
                            Add
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  );
                })
              )}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}

      {/* Confirm before granting leader access */}
      <AlertDialog open={!!leaderConfirm} onOpenChange={(o) => !o && setLeaderConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Give leader access?</AlertDialogTitle>
            <AlertDialogDescription>
              Leaders can see the group roster and take attendance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (leaderConfirm) void addToGroup(leaderConfirm.groupId, leaderConfirm.groupName, leaderConfirm.role);
              }}
            >
              Make leader
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm before removing a leader */}
      <AlertDialog open={!!removeConfirm} onOpenChange={(o) => !o && setRemoveConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove leader access?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeConfirm?.groupName} — this person will stop leading the group and lose roster and attendance access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removeConfirm) void removeFromGroup(removeConfirm.groupId, removeConfirm.groupName);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
