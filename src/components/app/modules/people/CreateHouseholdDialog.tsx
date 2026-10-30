"use client";

/**
 * CreateHouseholdDialog — create a household (name + optional address).
 * POST /households, then hands the created household back to the parent.
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

interface CreatedHousehold {
  id: string;
  name: string;
}

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

export default function CreateHouseholdDialog({ onClose, onDone }: {
  onClose: () => void;
  onDone: (h: { id: string; name: string }) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await api.post<CreatedHousehold>("/households", {
        name: name.trim(),
        addressLine1: addressLine1.trim() || undefined,
        city: city.trim() || undefined,
        region: region.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
      });
      toast.success(`Created household "${name.trim()}"`);
      void qc.invalidateQueries({ queryKey: ["households"] });
      void qc.invalidateQueries({ queryKey: ["people"] });
      onDone({ id: res.id, name: res.name });
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
          <DialogTitle>Create household</DialogTitle>
          <DialogDescription>Group people who live together. You can add members after creating.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="hhc-name">Name *</Label>
            <Input id="hhc-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hhc-addr1">Address line 1</Label>
            <Input id="hhc-addr1" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder="Street address" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="hhc-city">City</Label>
              <Input id="hhc-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hhc-region">Region</Label>
              <Input id="hhc-region" value={region} onChange={(e) => setRegion(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hhc-postal">Postal code</Label>
              <Input id="hhc-postal" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Create household"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
