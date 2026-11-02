"use client";

/**
 * People CRM v2 — row-click side drawer (PHASE 4 PLACEHOLDER).
 * Shows tier-gated quick facts from the v2 list row and points to the classic
 * record dialog for full editing until the Phase 4 profile lands.
 */
import { CalendarDays, Home, Mail, MapPin, MessageCircle, Phone, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { PersonAvatar, StageBadge } from "@/components/app/shared";
import { fmtDate } from "@/lib/types";
import { relLastSeen, waLink, type CrmPersonRow } from "./crm-shared";

function Fact({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="text-sm">{children}</div>
      </div>
    </div>
  );
}

export function CrmPersonDrawer({ row, onClose, onOpenFullRecord }: {
  row: CrmPersonRow | null;
  onClose: () => void;
  onOpenFullRecord?: (row: CrmPersonRow) => void;
}) {
  const open = row !== null;
  const name = row ? `${row.firstName} ${row.lastName}` : "";
  const wa = waLink(row?.whatsappE164 ?? row?.phoneE164);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-sm scroll-slim">
        {row ? (
          <>
            <SheetHeader className="space-y-3 border-b p-5 text-left">
              <div className="flex items-center gap-3">
                <PersonAvatar name={name} src={row.photoUrl} className="h-12 w-12 text-sm" />
                <div className="min-w-0">
                  <SheetTitle className="truncate text-base">{name}</SheetTitle>
                  <SheetDescription className="mt-0.5 flex items-center gap-2">
                    <StageBadge stage={row.lifecycleStage} />
                  </SheetDescription>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {row.tags.map((t) => (
                  <Badge key={t.id} variant="outline" className="font-normal" style={t.color ? { borderColor: t.color } : undefined}>
                    {t.name}
                  </Badge>
                ))}
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-4 p-5">
              <div className="grid gap-3">
                <Fact icon={Phone} label="Phone">
                  {row.phoneDisplay ? (
                    <span className="flex items-center gap-1.5">
                      <a href={`tel:${row.phoneE164 ?? row.phone}`} className="hover:underline">{row.phoneDisplay}</a>
                      {wa ? (
                        <a href={wa} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${name}`} className="rounded p-0.5 text-muted-foreground hover:text-success">
                          <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      ) : null}
                    </span>
                  ) : row.privacyHidden.includes("phone") ? <span className="text-muted-foreground">Hidden by privacy</span> : <span className="text-muted-foreground">—</span>}
                </Fact>
                <Fact icon={Mail} label="Email">
                  {row.email ? (
                    <a href={`mailto:${row.email}`} className="truncate hover:underline">{row.email}</a>
                  ) : row.privacyHidden.includes("email") ? <span className="text-muted-foreground">Hidden by privacy</span> : <span className="text-muted-foreground">—</span>}
                </Fact>
                <Fact icon={Home} label="Household">
                  {row.household ? `${row.household.name} · ${row.householdMemberCount} member${row.householdMemberCount === 1 ? "" : "s"}` : <span className="text-muted-foreground">—</span>}
                </Fact>
                <Fact icon={MapPin} label="Campus">{row.campusName ?? <span className="text-muted-foreground">—</span>}</Fact>
                <Fact icon={CalendarDays} label="Age">{row.age != null ? `${row.age} yrs` : <span className="text-muted-foreground">—</span>}</Fact>
                <Fact icon={Users} label="Groups">
                  {row.groups.length > 0 ? row.groups.map((g) => g.name).join(", ") : <span className="text-muted-foreground">—</span>}
                </Fact>
                <Fact icon={CalendarDays} label="Last seen">
                  {row.lastAttendedAt ? `${relLastSeen(row.lastAttendedAt).text} · ${fmtDate(row.lastAttendedAt)}` : "No attendance recorded"}
                </Fact>
              </div>

              <Separator />

              <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                Quick view only — the full profile editor (notes, giving, care, history) arrives with the
                Phase 4 CRM profile. Nothing here is editable yet.
              </div>
            </div>

            {onOpenFullRecord ? (
              <div className="border-t p-4">
                <Button type="button" variant="outline" className="w-full" onClick={() => onOpenFullRecord(row)}>
                  Open full record
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
