"use client";

/**
 * EditHouseholdDialog — rename / re-address an existing household.
 * PUT /households/:id with the same fields the create dialog uses.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";

interface HouseholdRow {
  id: string;
  name: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  deletedAt?: string | null;
  canEdit: boolean;
  members: { personId: string; name: string; photoUrl?: string | null; role: string; email?: string | null; phone?: string | null }[];
}

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

export default function EditHouseholdDialog({ household, onClose, onDone }: {
  household: HouseholdRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(household.name);
  const [addressLine1, setAddressLine1] = useState(household.addressLine1 ?? "");
  const [city, setCity] = useState(household.city ?? "");
  const [region, setRegion] = useState(household.region ?? "");
  const [postalCode, setPostalCode] = useState(household.postalCode ?? "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.put(`/households/${household.id}`, {
        name: name.trim(),
        addressLine1: addressLine1.trim() || undefined,
        city: city.trim() || undefined,
        region: region.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
      });
      toast.success(`Updated household "${name.trim()}"`);
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
          <DialogTitle>Edit household</DialogTitle>
          <DialogDescription>Update the name or mailing address for {household.name}.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="hhe-name">Name *</Label>
            <Input id="hhe-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hhe-addr1">Address line 1</Label>
            <Input id="hhe-addr1" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder="Street address" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="hhe-city">City</Label>
              <Input id="hhe-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hhe-region">Region</Label>
              <Input id="hhe-region" value={region} onChange={(e) => setRegion(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hhe-postal">Postal code</Label>
              <Input id="hhe-postal" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
