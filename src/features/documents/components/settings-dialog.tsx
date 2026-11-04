"use client";

/**
 * DMS admin settings — allowed file types, size caps, storage quota, retention,
 * default access level, approval requirement, virus-scan toggle.
 * Server-enforced again on save (documents.settings).
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentSettings } from "../hooks/use-documents";
import { useDocumentMutations } from "../hooks/use-document-mutations";
import { ACCESS_LEVELS_DMS, ACCESS_LEVEL_META } from "../constants";
import { MIME_BY_EXT } from "../utils";
import { settingsSchema } from "../schemas";
import { fmtDateTime } from "../utils";
import { Loader2 } from "lucide-react";

const COMMON_TYPES: { mime: string; label: string }[] = Object.entries(MIME_BY_EXT)
  .filter(([ext]) => ["pdf", "png", "jpg", "webp", "txt", "csv", "docx", "xlsx", "pptx", "doc", "xls", "ppt"].includes(ext))
  .map(([ext, mime]) => ({ mime, label: ext.toUpperCase() }))
  .filter((t, i, arr) => arr.findIndex((x) => x.mime === t.mime) === i);

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { data, isLoading } = useDocumentSettings(open);
  const mutations = useDocumentMutations();
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState({
    maxSizeMb: 25,
    staffMaxSizeMb: 100,
    quotaMb: 2048,
    retentionDays: "" as string,
    defaultAccessLevel: "members",
    requireApproval: true,
    watermarkedByDefault: false,
    virusScanEnabled: true,
    mimes: new Set<string>(),
  });

  useEffect(() => {
    if (!data) return;
    setState({
      maxSizeMb: data.maxSizeMb,
      staffMaxSizeMb: data.staffMaxSizeMb,
      quotaMb: data.quotaMb,
      retentionDays: data.retentionDays ? String(data.retentionDays) : "",
      defaultAccessLevel: data.defaultAccessLevel,
      requireApproval: data.requireApproval,
      watermarkedByDefault: data.watermarkedByDefault,
      virusScanEnabled: data.virusScanEnabled,
      mimes: new Set(data.allowedMimes),
    });
  }, [data]);

  const save = async () => {
    if (!state.mimes.size) {
      toast.error("Allow at least one file type.");
      return;
    }
    const payload = {
      allowedMimes: [...state.mimes],
      maxSizeMb: state.maxSizeMb,
      staffMaxSizeMb: state.staffMaxSizeMb,
      quotaMb: state.quotaMb,
      retentionDays: state.retentionDays ? Number(state.retentionDays) : null,
      defaultAccessLevel: state.defaultAccessLevel,
      requireApproval: state.requireApproval,
      watermarkedByDefault: state.watermarkedByDefault,
      virusScanEnabled: state.virusScanEnabled,
    };
    const parsed = settingsSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the settings values.");
      return;
    }
    setSaving(true);
    try {
      await mutations.saveSettings(payload);
      onOpenChange(false);
    } catch {
      /* toast shown */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg" role="dialog" aria-label="DMS settings">
        <DialogHeader>
          <DialogTitle>DMS settings</DialogTitle>
          <DialogDescription>
            Tenant-wide document policy. The server enforces these on every upload regardless of what the client sends.
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="grid gap-4">
            <fieldset className="grid gap-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Allowed file types</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {COMMON_TYPES.map((t) => (
                  <label key={t.mime} className="flex items-center gap-1.5 text-sm text-ink-secondary">
                    <Checkbox
                      checked={state.mimes.has(t.mime)}
                      onCheckedChange={(v) =>
                        setState((s) => {
                          const next = new Set(s.mimes);
                          if (v === true) next.add(t.mime);
                          else next.delete(t.mime);
                          return { ...s, mimes: next };
                        })
                      }
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="set-max">Member max size (MB)</Label>
                <Input id="set-max" type="number" min={1} value={state.maxSizeMb} onChange={(e) => setState((s) => ({ ...s, maxSizeMb: Number(e.target.value) }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="set-staff">Staff max size (MB)</Label>
                <Input id="set-staff" type="number" min={1} value={state.staffMaxSizeMb} onChange={(e) => setState((s) => ({ ...s, staffMaxSizeMb: Number(e.target.value) }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="set-quota">Storage quota (MB)</Label>
                <Input id="set-quota" type="number" min={64} value={state.quotaMb} onChange={(e) => setState((s) => ({ ...s, quotaMb: Number(e.target.value) }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="set-retention">Retention (days, archived docs)</Label>
                <Input id="set-retention" type="number" min={30} placeholder="—" value={state.retentionDays} onChange={(e) => setState((s) => ({ ...s, retentionDays: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="set-access">Default access level for new uploads</Label>
              <Select value={state.defaultAccessLevel} onValueChange={(v) => setState((s) => ({ ...s, defaultAccessLevel: v }))}>
                <SelectTrigger id="set-access"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCESS_LEVELS_DMS.map((l) => (
                    <SelectItem key={l} value={l}>{ACCESS_LEVEL_META[l].label} — {ACCESS_LEVEL_META[l].description}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-ink-secondary">
                <Checkbox checked={state.requireApproval} onCheckedChange={(v) => setState((s) => ({ ...s, requireApproval: v === true }))} />
                Require approval before publishing (draft → review → approve → publish)
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-secondary">
                <Checkbox checked={state.watermarkedByDefault} onCheckedChange={(v) => setState((s) => ({ ...s, watermarkedByDefault: v === true }))} />
                Watermark previews by default
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-secondary">
                <Checkbox checked={state.virusScanEnabled} onCheckedChange={(v) => setState((s) => ({ ...s, virusScanEnabled: v === true }))} />
                Virus / malware scan pipeline
              </label>
            </div>
            {data.updatedAt ? (
              <p className="text-xs text-ink-muted">Last updated {fmtDateTime(data.updatedAt)}{data.updatedByName ? ` by ${data.updatedByName}` : ""}.</p>
            ) : null}
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Save settings
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
