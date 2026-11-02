"use client";

/**
 * People CRM Phase 7 — public Visitor Connect Card (no login).
 *
 * Rendered for #/connect/:slug deep links. Reads only the form's public
 * config (church name + fields + thank-you text); submits via the
 * rate-limited public endpoint. Includes the honeypot field ("Website" —
 * hidden from humans, irresistible to bots). Tenant safety: the slug is
 * the authoritative org key and nothing else is exposed client-side.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Church, CheckCircle2, Loader2, Mail, Phone } from "lucide-react";

interface PublicFormMeta {
  churchName: string;
  formName: string;
  thankYouMessage: string | null;
  fields: {
    key: string;
    label: string;
    type: "text" | "textarea" | "select" | "phone" | "email" | "date";
    options?: readonly string[];
    enabled: boolean;
    required: boolean;
  }[];
}

export function ConnectForm({ slug, onExit }: { slug: string; onExit?: () => void }) {
  const metaQ = useQuery<PublicFormMeta>({
    queryKey: ["public", "connect", slug],
    queryFn: () => api.get<PublicFormMeta>(`/public/connect/${encodeURIComponent(slug)}`),
    retry: false,
  });

  if (metaQ.isLoading) {
    return (
      <PublicShell>
        <div className="grid place-items-center py-16" role="status">
          <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden />
          <p className="mt-3 text-sm text-muted-foreground">Loading the connect card…</p>
        </div>
      </PublicShell>
    );
  }

  if (metaQ.isError || !metaQ.data) {
    return (
      <PublicShell>
        <div className="py-16 text-center">
          <p className="text-lg font-semibold">This form isn&apos;t available</p>
          <p className="mt-1 text-sm text-muted-foreground">The link may be wrong or the card may have been paused. Please ask your church for a fresh link.</p>
          {onExit ? <Button type="button" variant="outline" className="mt-6" onClick={onExit}>Back to sign in</Button> : null}
        </div>
      </PublicShell>
    );
  }

  return <ConnectFormFields meta={metaQ.data} slug={slug} onExit={onExit} />;
}

function ConnectFormFields({ meta, slug, onExit }: { meta: PublicFormMeta; slug: string; onExit?: () => void }) {
  const enabled = useMemo(() => meta.fields.filter((f) => f.enabled), [meta.fields]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(`/public/connect/${encodeURIComponent(slug)}/submit`, values);
      setDone(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <PublicShell>
        <div className="grid place-items-center gap-3 py-14 text-center">
          <CheckCircle2 className="h-12 w-12 text-success" aria-hidden />
          <p className="text-lg font-semibold">{done}</p>
          <p className="max-w-sm text-sm text-muted-foreground">You can close this page now — we look forward to seeing you.</p>
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <form onSubmit={submit} className="relative space-y-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          {enabled.map((f) => {
            const id = `cf-${f.key}`;
            const value = values[f.key] ?? "";
            const wide = f.type === "textarea" || f.key === "address";
            return (
              <div key={f.key} className={cn("grid gap-1.5", wide && "sm:col-span-2")}>
                <Label htmlFor={id}>
                  {f.label}{f.required ? <span className="text-destructive"> *</span> : null}
                </Label>
                {f.type === "textarea" ? (
                  <Textarea id={id} value={value} onChange={(e) => set(f.key, e.target.value)} rows={3} required={f.required} />
                ) : f.type === "select" ? (
                  <Select value={value || undefined} onValueChange={(v) => set(f.key, v)}>
                    <SelectTrigger id={id} aria-label={f.label}><SelectValue placeholder="Choose…" /></SelectTrigger>
                    <SelectContent>
                      {(f.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="relative">
                    {f.type === "phone" ? <Phone className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden /> : null}
                    {f.type === "email" ? <Mail className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden /> : null}
                    <Input
                      id={id}
                      type={f.type === "email" ? "email" : f.type === "date" ? "date" : f.type === "phone" ? "tel" : "text"}
                      value={value}
                      onChange={(e) => set(f.key, e.target.value)}
                      required={f.required}
                      autoComplete={f.key === "firstName" || f.key === "lastName" ? "name" : f.type === "email" ? "email" : f.type === "phone" ? "tel" : "off"}
                      inputMode={f.type === "phone" ? "tel" : undefined}
                      className={cn(f.type === "phone" || f.type === "email" ? "pl-8" : undefined, f.type === "phone" && "font-mono")}
                      placeholder={f.type === "phone" ? "0803 123 4567" : undefined}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* honeypot — visually hidden, keyboard/sr hidden too; bots still fill it */}
        <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
          <label htmlFor="cf-website">Website</label>
          <input id="cf-website" type="text" tabIndex={-1} autoComplete="off" value={values["website"] ?? ""}
            onChange={(e) => set("website", e.target.value)} />
        </div>

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>
        ) : null}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {busy ? "Sending…" : "I'm here — send my details"}
        </Button>
        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
          Your details go only to {meta.churchName} and are used to welcome you and follow up on your visit.
        </p>
      </form>

      {onExit ? (
        <button type="button" onClick={onExit} className="mt-6 block w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline">
          Church staff? Sign in here
        </button>
      ) : null}
    </PublicShell>
  );
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-sunken px-4 py-8">
      <main className="mx-auto w-full max-w-md">
        <div className="mb-5 flex items-center justify-center gap-2 text-center">
          <Church className="h-5 w-5 text-primary" aria-hidden />
          <span className="font-semibold">Welcome</span>
        </div>
        <section className="rounded-2xl border bg-card p-6 shadow-sm">{children}</section>
      </main>
    </div>
  );
}
