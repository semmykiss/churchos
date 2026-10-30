"use client";

/**
 * LinkDependentDialog — attach a dependent to this person (as guardian).
 * Two modes: link an existing person, or create a new child/dependent with
 * the guardian link in one call (with duplicate detection and amber alert).
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PersonAvatar } from "@/components/app/shared";
import { api, ApiError } from "@/lib/api";
import {
  GUARDIAN_RELATIONSHIP_TYPES, type GuardianRelationshipType, type PersonListItem,
} from "@/lib/types";
import { PersonCombobox } from "./person-search";

interface Dup {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  birthdate?: string | null;
  lifecycleStage?: string;
}

interface CreatePersonResponse {
  duplicates: { exact: Dup[]; fuzzy: Dup[] } | null;
  created: { id: string; name: string } | null;
}

type DependentMode = "existing" | "new";

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong.";
}

function fullName(p: { firstName: string; lastName: string; preferredName?: string | null }): string {
  const base = `${p.firstName} ${p.lastName}`;
  return p.preferredName ? `${base} (${p.preferredName})` : base;
}

export default function LinkDependentDialog({ personId, personName, onClose, onDone }: {
  personId: string;
  personName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<DependentMode>("existing");
  const [picked, setPicked] = useState<PersonListItem | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [relationshipType, setRelationshipType] = useState<GuardianRelationshipType>("guardian");
  const [authorizedPickup, setAuthorizedPickup] = useState(true);
  const [custodyRestricted, setCustodyRestricted] = useState(false);
  const [duplicates, setDuplicates] = useState<{ exact: Dup[]; fuzzy: Dup[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (mode === "existing" && !picked) return;
    setBusy(true);
    setDuplicates(null);
    try {
      if (mode === "existing") {
        // The picked person is the dependent; personId (the parent) is the guardian.
        await api.post(`/people/${picked!.id}/guardians`, {
          guardianId: personId,
          relationshipType,
          authorizedPickup,
          custodyRestricted,
        });
        toast.success(`Linked ${personName} as guardian of ${fullName(picked!)}`);
        void qc.invalidateQueries({ queryKey: ["people"] });
        onDone();
        return;
      }
      const res = await api.post<CreatePersonResponse>("/people", {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        birthdate: birthdate || undefined,
        lifecycleStage: "attender",
        guardians: [{ guardianId: personId, relationshipType, authorizedPickup, custodyRestricted }],
      });
      if (res.created) {
        toast.success(`Created ${res.created.name} with ${personName} as guardian`);
        void qc.invalidateQueries({ queryKey: ["people"] });
        onDone();
        return;
      }
      if (res.duplicates) {
        setDuplicates(res.duplicates);
      }
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const dupList = duplicates
    ? [
        ...duplicates.exact.map((d) => ({ d, kind: "Exact match" })),
        ...duplicates.fuzzy.map((d) => ({ d, kind: "Similar" })),
      ]
    : [];
  const dupCount = dupList.length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Link dependent</DialogTitle>
          <DialogDescription>
            Add a child or dependent under {personName}’s guardianship.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label>Who is the dependent?</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => {
                setMode(v as DependentMode);
                setDuplicates(null);
              }}
              className="flex flex-row gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="existing" id="dep-mode-existing" />
                <Label htmlFor="dep-mode-existing" className="font-normal">Add an existing person</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="new" id="dep-mode-new" />
                <Label htmlFor="dep-mode-new" className="font-normal">Create a new child/dependent</Label>
              </div>
            </RadioGroup>
          </div>

          {mode === "existing" ? (
            <PersonCombobox value={picked?.id ?? null} onSelect={setPicked} excludePersonIds={[personId]} />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="dep-first">First name *</Label>
                  <Input id="dep-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoFocus />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dep-last">Last name *</Label>
                  <Input id="dep-last" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dep-birth">Birthdate</Label>
                <Input id="dep-birth" type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="dep-rel">Relationship</Label>
            <Select value={relationshipType} onValueChange={(v) => setRelationshipType(v as GuardianRelationshipType)}>
              <SelectTrigger id="dep-rel" aria-label="Relationship">
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
              <Switch id="dep-pickup" checked={authorizedPickup} onCheckedChange={setAuthorizedPickup} />
              <Label htmlFor="dep-pickup" className="font-normal">Authorized for pickup</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="dep-custody" checked={custodyRestricted} onCheckedChange={setCustodyRestricted} />
              <Label htmlFor="dep-custody" className="font-normal">Custody restricted</Label>
            </div>
          </div>

          {duplicates ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
              <p className="flex items-center gap-1.5 font-medium text-amber-900 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4" /> {dupCount} possible {dupCount === 1 ? "duplicate" : "duplicates"} found
              </p>
              <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto scroll-slim">
                {dupList.map(({ d, kind }) => (
                  <li key={`${kind}-${d.id}`} className="flex items-center gap-2 rounded-md bg-background/70 px-2 py-1.5">
                    <PersonAvatar name={d.name} className="h-6 w-6 text-[9px]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{d.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {[d.email, d.phone].filter(Boolean).join(" · ") || "No contact info"}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px]">{kind}</Badge>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-amber-800/80 dark:text-amber-200/70">
                Not creating automatically — adjust the name, or switch to “Add an existing person” to link them instead.
              </p>
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || (mode === "existing" && !picked)}>
              {busy ? "Saving…" : mode === "existing" ? "Link dependent" : "Create and link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
