"use client";

/**
 * People CRM (Phase 6) — custom field definitions admin screen ("Fields" tab).
 * Requires "people.customfields.manage" (the parent only mounts it for those
 * viewers — every endpoint re-enforces the permission server-side).
 *
 * Field types: text · long text · number · date · yes/no · single select ·
 * multi-select · URL. Per field: required, visible-to-roles, editable-by-roles,
 * show-in-table, usable-in-filters (+ the legacy coarse visibility + PII flag).
 * One-click presets create the common Nigerian-church field sets.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Pencil, Plus, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LoadingBlock, EmptyState, useApiQuery } from "@/components/app/shared";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { CustomFieldDefDTO, CustomFieldDataType } from "./crm-shared";

const DATA_TYPES: { value: CustomFieldDataType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "long_text", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes / No" },
  { value: "select", label: "Single select" },
  { value: "multi_select", label: "Multi-select" },
  { value: "url", label: "URL" },
];

const PRESETS = [
  { key: "cell_home_fellowship", label: "Cell / Home Fellowship" },
  { key: "zone_area_parish", label: "Zone / Area / Parish" },
  { key: "foundation_school", label: "Foundation School status" },
  { key: "department_unit", label: "Department / Unit" },
];

/** Preset role keys — mirrors the server's SYSTEM_ROLES (kept local so the
 *  server permission module is never bundled into client code). */
const ROLE_OPTIONS = [
  { key: "owner", label: "Owner / Super Admin" },
  { key: "campus_admin", label: "Church Admin" },
  { key: "finance", label: "Church Accountant" },
  { key: "pastor", label: "Pastor" },
  { key: "head_usher", label: "Head Usher" },
  { key: "minister", label: "Minister" },
  { key: "ministry_leader", label: "HOD / Ministry Leader" },
  { key: "volunteer", label: "Volunteer" },
  { key: "member", label: "Member" },
  { key: "parent", label: "Parent / Guardian" },
];

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

interface EditorState {
  id: string | null; // null = create
  label: string;
  key: string;
  keyTouched: boolean;
  dataType: CustomFieldDataType;
  optionsText: string;
  required: boolean;
  showInList: boolean;
  filterable: boolean;
  pii: boolean;
  visibility: string;
  visibleToRoles: string[];
  editableByRoles: string[];
}

function emptyEditor(): EditorState {
  return {
    id: null, label: "", key: "", keyTouched: false, dataType: "text", optionsText: "",
    required: false, showInList: false, filterable: true, pii: false,
    visibility: "staff", visibleToRoles: [], editableByRoles: [],
  };
}

function editorFrom(def: CustomFieldDefDTO): EditorState {
  return {
    id: def.id, label: def.label, key: def.key, keyTouched: true, dataType: def.dataType,
    optionsText: def.options.join("\n"), required: def.required, showInList: def.showInList,
    filterable: def.filterable, pii: def.pii, visibility: def.visibility,
    visibleToRoles: [...def.visibleToRoles], editableByRoles: [...def.editableByRoles],
  };
}

export function CustomFieldsAdmin() {
  const qc = useQueryClient();
  const defsQ = useApiQuery<{ items: CustomFieldDefDTO[] }>(
    ["people", "customfields", "manage"],
    "/people/custom-fields?archived=1"
  );
  const defs = defsQ.data?.items ?? [];
  const active = defs.filter((d) => !d.archivedAt);
  const archived = defs.filter((d) => d.archivedAt);

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [presetBusy, setPresetBusy] = useState<string | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["people", "customfields"] });
    void qc.invalidateQueries({ queryKey: ["people", "v2"] });
  };

  async function saveEditor() {
    if (!editor) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        label: editor.label.trim(),
        dataType: editor.dataType,
        required: editor.required,
        showInList: editor.showInList,
        filterable: editor.filterable,
        pii: editor.pii,
        visibility: editor.visibility,
        visibleToRoles: editor.visibleToRoles,
        editableByRoles: editor.editableByRoles,
      };
      if (editor.dataType === "select" || editor.dataType === "multi_select") {
        body.options = editor.optionsText.split("\n").map((s) => s.trim()).filter(Boolean);
      }
      if (editor.id) {
        await api.patch(`/people/custom-fields/${editor.id}`, body);
        toast.success("Field updated");
      } else {
        body.key = editor.key || slugify(editor.label);
        await api.post("/people/custom-fields", body);
        toast.success("Field created");
      }
      setEditor(null);
      invalidate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the field.");
    } finally {
      setBusy(false);
    }
  }

  async function archive(def: CustomFieldDefDTO) {
    setBusy(true);
    try {
      await api.del(`/people/custom-fields/${def.id}`);
      toast.success(`"${def.label}" archived — existing values are kept.`);
      invalidate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not archive the field.");
    } finally {
      setBusy(false);
    }
  }

  async function applyPreset(presetKey: string) {
    setPresetBusy(presetKey);
    try {
      const res = await api.post<{ label: string; created: number; skipped: number }>(
        "/people/custom-fields/presets",
        { preset: presetKey }
      );
      toast.success(`${res.label}: ${res.created} field${res.created === 1 ? "" : "s"} added${res.skipped ? ` (${res.skipped} already existed)` : ""}`);
      invalidate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not apply the preset.");
    } finally {
      setPresetBusy(null);
    }
  }

  const optionsNeeded = editor?.dataType === "select" || editor?.dataType === "multi_select";

  const roleToggle = (list: string[], setList: (next: string[]) => void, roleKey: string) => {
    setList(list.includes(roleKey) ? list.filter((k) => k !== roleKey) : [...list, roleKey]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => setEditor(emptyEditor())}>
          <Plus className="h-4 w-4" aria-hidden /> New field
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">One-click presets:</span>
          {PRESETS.map((p) => (
            <Button
              key={p.key}
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              disabled={presetBusy !== null}
              onClick={() => void applyPreset(p.key)}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {presetBusy === p.key ? "Adding…" : p.label}
            </Button>
          ))}
        </div>
      </div>

      {defsQ.isLoading ? (
        <LoadingBlock label="Loading custom fields…" />
      ) : active.length === 0 && archived.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No custom fields yet"
          description="Create fields like “Foundation school status”, or start from a preset above. They appear in the add/edit form, the table column chooser and the filters."
        />
      ) : (
        <ul className="space-y-2" aria-label="Custom fields">
          {active.map((def) => (
            <li key={def.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {def.label}
                    <code className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{def.key}</code>
                    {def.required ? <Badge variant="outline" className="text-[9px]">Required</Badge> : null}
                    {def.showInList ? <Badge variant="outline" className="text-[9px]">Show in table</Badge> : null}
                    {def.filterable ? <Badge variant="outline" className="text-[9px]">Filterable</Badge> : null}
                    {def.pii ? <Badge variant="outline" className="text-[9px]">PII</Badge> : null}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {DATA_TYPES.find((t) => t.value === def.dataType)?.label ?? def.dataType}
                    {def.options.length > 0 ? ` · ${def.options.join(", ")}` : ""}
                    {" · visible: "}
                    {def.visibleToRoles.length > 0
                      ? def.visibleToRoles.map((k) => ROLE_OPTIONS.find((r) => r.key === k)?.label ?? k).join(", ")
                      : def.visibility}
                    {" · editable: "}
                    {def.editableByRoles.length > 0
                      ? def.editableByRoles.map((k) => ROLE_OPTIONS.find((r) => r.key === k)?.label ?? k).join(", ")
                      : "anyone who can edit the person"}
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setEditor(editorFrom(def))}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  onClick={() => void archive(def)}
                >
                  <Archive className="h-3.5 w-3.5" aria-hidden /> Archive
                </Button>
              </div>
            </li>
          ))}
          {archived.length > 0 ? (
            <li className="pt-2">
              <p className="text-xs font-medium text-muted-foreground">Archived</p>
              <ul className="mt-1.5 space-y-1">
                {archived.map((def) => (
                  <li key={def.id} className="flex items-center gap-2 rounded-md border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground">
                    <Archive className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{def.label}</span>
                    <code className="rounded bg-muted px-1 text-[10px]">{def.key}</code>
                    <span className="ml-auto text-[10px]">values kept</span>
                  </li>
                ))}
              </ul>
            </li>
          ) : null}
        </ul>
      )}

      <Dialog open={editor !== null} onOpenChange={(o) => !o && setEditor(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto scroll-slim">
          <DialogHeader>
            <DialogTitle>{editor?.id ? "Edit field" : "New custom field"}</DialogTitle>
            <DialogDescription>
              Fields appear in the add/edit form, and — when enabled — in the table column chooser and filters.
              Role gates are enforced server-side.
            </DialogDescription>
          </DialogHeader>
          {editor ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cfd-label">Label *</Label>
                  <Input
                    id="cfd-label"
                    value={editor.label}
                    onChange={(e) => setEditor({ ...editor, label: e.target.value, key: editor.keyTouched ? editor.key : slugify(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cfd-key">Key {editor.id ? "(immutable)" : "*"}</Label>
                  <Input
                    id="cfd-key"
                    value={editor.key}
                    disabled={Boolean(editor.id)}
                    onChange={(e) => setEditor({ ...editor, key: slugify(e.target.value), keyTouched: true })}
                    placeholder="foundation_school_status"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cfd-type">Field type</Label>
                <Select
                  value={editor.dataType}
                  onValueChange={(v) => setEditor({ ...editor, dataType: v as CustomFieldDataType })}
                >
                  <SelectTrigger id="cfd-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DATA_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {optionsNeeded ? (
                <div className="space-y-1.5">
                  <Label htmlFor="cfd-options">Options * (one per line)</Label>
                  <Textarea
                    id="cfd-options"
                    value={editor.optionsText}
                    onChange={(e) => setEditor({ ...editor, optionsText: e.target.value })}
                    rows={4}
                    placeholder={"Not started\nEnrolled\nGraduated"}
                  />
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-2 rounded-lg border p-3 sm:grid-cols-2">
                {([
                  ["required", "Required", "Must be filled when saving a person"],
                  ["showInList", "Show in table", "Offered in the column chooser"],
                  ["filterable", "Usable in filters", "Appears in the filter builder"],
                  ["pii", "Sensitive (PII)", "Only staff & finance ever see values"],
                ] as const).map(([key, label, hint]) => (
                  <div key={key} className="flex items-start justify-between gap-2">
                    <div>
                      <Label htmlFor={`cfd-${key}`} className="text-xs">{label}</Label>
                      <p className="text-[10px] text-muted-foreground">{hint}</p>
                    </div>
                    <Switch
                      id={`cfd-${key}`}
                      checked={editor[key]}
                      onCheckedChange={(v) => setEditor({ ...editor, [key]: v })}
                    />
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cfd-visibility">Default visibility</Label>
                <Select value={editor.visibility} onValueChange={(v) => setEditor({ ...editor, visibility: v })}>
                  <SelectTrigger id="cfd-visibility"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="staff">Staff only</SelectItem>
                    <SelectItem value="leaders">Staff & leaders</SelectItem>
                    <SelectItem value="member">Everyone on the profile</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">Ignored when an explicit role list is set below.</p>
              </div>
              <RoleChecklist
                id="cfd-visibility-roles"
                title="Visible to roles (optional)"
                hint="Values are hidden from everyone else — omitted from payloads entirely."
                selected={editor.visibleToRoles}
                onToggle={(k) => roleToggle(editor.visibleToRoles, (next) => setEditor({ ...editor, visibleToRoles: next }), k)}
              />
              <RoleChecklist
                id="cfd-editable-roles"
                title="Editable by roles (optional)"
                hint="Writes by other roles are rejected server-side, per field."
                selected={editor.editableByRoles}
                onToggle={(k) => roleToggle(editor.editableByRoles, (next) => setEditor({ ...editor, editableByRoles: next }), k)}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setEditor(null)}>Cancel</Button>
            <Button type="button" disabled={busy || !editor?.label.trim() || (optionsNeeded && editor.optionsText.split("\n").map((s) => s.trim()).filter(Boolean).length < 2)} onClick={() => void saveEditor()}>
              {busy ? "Saving…" : editor?.id ? "Save changes" : "Create field"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleChecklist({ id, title, hint, selected, onToggle }: {
  id: string;
  title: string;
  hint: string;
  selected: string[];
  onToggle: (roleKey: string) => void;
}) {
  return (
    <fieldset className="rounded-lg border p-3" aria-describedby={`${id}-hint`}>
      <legend className="px-1 text-xs font-semibold">{title}</legend>
      <p id={`${id}-hint`} className="mb-2 text-[10px] text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap gap-1.5">
        {ROLE_OPTIONS.map((r) => {
          const checked = selected.includes(r.key);
          return (
            <label
              key={r.key}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                checked ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"
              )}
            >
              <Checkbox checked={checked} onCheckedChange={() => onToggle(r.key)} />
              {r.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
