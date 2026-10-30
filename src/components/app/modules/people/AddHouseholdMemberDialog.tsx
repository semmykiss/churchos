"use client";

/**
 * AddHouseholdMemberDialog — pick an existing person and a household role,
 * then POST /households/:id/members. The API rejects duplicate membership.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { HOUSEHOLD_ROLES, HOUSEHOLD_ROLE_LABELS, type PersonListItem } from "@/lib/types";
import { PersonCombobox } from "./person-search";

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

function fullName(p: { firstName: string; lastName: string; preferredName?: string | null }): string {
  const base = `${p.firstName} ${p.lastName}`;
  return p.preferredName ? `${base} (${p.preferredName})` : base;
}

export default function AddHouseholdMemberDialog({ householdId, householdName, onClose, onDone }: {
  householdId: string;
  householdName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [person, setPerson] = useState<PersonListItem | null>(null);
  const [role, setRole] = useState("adult");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!person) return;
    setBusy(true);
    try {
      await api.post(`/households/${householdId}/members`, { personId: person.id, role });
      toast.success(`Added ${fullName(person)} to ${householdName}`);
      void qc.invalidateQueries({ queryKey: ["households"] });
      void qc.invalidateQueries({ queryKey: ["people"] });
      onDone();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add household member</DialogTitle>
          <DialogDescription>Add an existing person to the {householdName} household.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <PersonCombobox value={person?.id ?? null} onSelect={setPerson} />

          <div className="space-y-1.5">
            <Label htmlFor="hhm-role">Household role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="hhm-role" aria-label="Household role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOUSEHOLD_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {HOUSEHOLD_ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !person}>
              {busy ? "Saving…" : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
