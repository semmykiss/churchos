"use client";

/**
 * LinkGuardianDialog — link an existing adult as a guardian of a person.
 * POST /people/:personId/guardians with pickup + custody flags.
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
import { Switch } from "@/components/ui/switch";
import { api, ApiError } from "@/lib/api";
import {
  GUARDIAN_RELATIONSHIP_TYPES, type GuardianRelationshipType, type PersonListItem,
} from "@/lib/types";
import { PersonCombobox } from "./person-search";

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

function fullName(p: { firstName: string; lastName: string; preferredName?: string | null }): string {
  const base = `${p.firstName} ${p.lastName}`;
  return p.preferredName ? `${base} (${p.preferredName})` : base;
}

export default function LinkGuardianDialog({ personId, personName, onClose, onDone }: {
  personId: string;
  personName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<PersonListItem | null>(null);
  const [relationshipType, setRelationshipType] = useState<GuardianRelationshipType>("guardian");
  const [authorizedPickup, setAuthorizedPickup] = useState(true);
  const [custodyRestricted, setCustodyRestricted] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!picked) return;
    setBusy(true);
    try {
      await api.post(`/people/${personId}/guardians`, {
        guardianId: picked.id,
        relationshipType,
        authorizedPickup,
        custodyRestricted,
      });
      toast.success(`Linked ${fullName(picked)} as guardian of ${personName}`);
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
          <DialogTitle>Link guardian</DialogTitle>
          <DialogDescription>Link an existing adult as guardian of {personName}.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <PersonCombobox value={picked?.id ?? null} onSelect={setPicked} excludePersonIds={[personId]} />

          <div className="space-y-1.5">
            <Label htmlFor="grd-rel">Relationship</Label>
            <Select value={relationshipType} onValueChange={(v) => setRelationshipType(v as GuardianRelationshipType)}>
              <SelectTrigger id="grd-rel" aria-label="Relationship">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GUARDIAN_RELATIONSHIP_TYPES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Switch id="grd-pickup" checked={authorizedPickup} onCheckedChange={setAuthorizedPickup} />
              <Label htmlFor="grd-pickup" className="font-normal">Authorized for pickup</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="grd-custody" checked={custodyRestricted} onCheckedChange={setCustodyRestricted} />
              <Label htmlFor="grd-custody" className="font-normal">Custody restricted</Label>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !picked}>
              {busy ? "Saving…" : "Link guardian"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
