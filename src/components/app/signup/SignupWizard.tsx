"use client";

/**
 * SignupWizard — tenant onboarding (spec §4/§7). Eight guided steps with
 * per-step validation ("Next" is blocked until THIS step is valid), a live
 * subdomain availability picker, file uploads for CAC/ID documents, a
 * redacted review screen, and the atomic submit. On success it hands over to
 * SignupSuccess. Anti-bot: a hidden honeypot field (CAPTCHA/Turnstile is the
 * production upgrade).
 */
import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { LoadingBlock } from "@/components/app/shared";
import { NigerianStateLgaSelect } from "@/components/app/signup/NigerianStateLgaSelect";
import { DPA_VERSION } from "@/lib/nigeria";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, ArrowRight, Building2, Scale, Users, MapPin, Landmark, ShieldCheck,
  UserRound, ClipboardCheck, Church, Loader2, Check, UploadCloud, FileText,
  Trash2, Globe, AlertTriangle,
} from "lucide-react";

const SignupSuccess = dynamic(() => import("@/components/app/signup/SignupSuccess"), { ssr: false });
type SuccessData = import("@/components/app/signup/SignupSuccess").SuccessData;

// ── types ────────────────────────────────────────────────────────────────────

interface FilePayload { name: string; contentType: string; dataBase64: string }

interface Trustee {
  fullName: string; trusteeRole: string; phone: string; email: string;
  residentialAddress: string; idType: string; idNumber: string; idDocument: FilePayload | null;
}

interface WizardData {
  displayName: string; registeredLegalName: string; denomination: string; foundedOn: string;
  preferredSubdomain: string;
  cacNumber: string; cacRegistrationDate: string; cacCertificate: FilePayload | null; tin: string; scumlNumber: string;
  trustees: Trustee[];
  registeredAddressLine1: string; registeredAddressLine2: string;
  registeredState: string; registeredLga: string;
  worshipSameAsRegistered: boolean; worshipAddress: string;
  headPastorName: string; headPastorPhone: string; headPastorEmail: string; headPastorNin: string;
  bankName: string; bankAccountNumber: string; bankAccountName: string;
  ndpaAcknowledged: boolean;
  ownerFullName: string; ownerEmail: string; ownerPhone: string; ownerPassword: string; ownerPassword2: string; confirmAuthorized: boolean;
  memberCountEstimate: string;
  honeypot: string;
}

const INITIAL: WizardData = {
  displayName: "", registeredLegalName: "", denomination: "", foundedOn: "", preferredSubdomain: "",
  cacNumber: "", cacRegistrationDate: "", cacCertificate: null, tin: "", scumlNumber: "",
  trustees: [
    { fullName: "", trusteeRole: "Chairman", phone: "", email: "", residentialAddress: "", idType: "nin", idNumber: "", idDocument: null },
    { fullName: "", trusteeRole: "Secretary", phone: "", email: "", residentialAddress: "", idType: "nin", idNumber: "", idDocument: null },
  ],
  registeredAddressLine1: "", registeredAddressLine2: "", registeredState: "", registeredLga: "",
  worshipSameAsRegistered: true, worshipAddress: "",
  headPastorName: "", headPastorPhone: "", headPastorEmail: "", headPastorNin: "",
  bankName: "", bankAccountNumber: "", bankAccountName: "",
  ndpaAcknowledged: false,
  ownerFullName: "", ownerEmail: "", ownerPhone: "", ownerPassword: "", ownerPassword2: "", confirmAuthorized: false,
  memberCountEstimate: "",
  honeypot: "",
};

const STEPS = [
  { key: "identity", label: "Church identity", icon: Church },
  { key: "legal", label: "Legal & regulatory", icon: Scale },
  { key: "trustees", label: "Trustees", icon: Users },
  { key: "address", label: "Address & leadership", icon: MapPin },
  { key: "banking", label: "Banking", icon: Landmark },
  { key: "data", label: "Data protection", icon: ShieldCheck },
  { key: "owner", label: "Owner account", icon: UserRound },
  { key: "review", label: "Review & submit", icon: ClipboardCheck },
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ── small shared field components ────────────────────────────────────────────

function Field({ label, children, hint, error, htmlFor }: { label: string; children: React.ReactNode; hint?: string; error?: string; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}

function FileField({ file, onFile, accept = "application/pdf,image/png,image/jpeg,image/webp", label, hint }: {
  file: FilePayload | null;
  onFile: (f: FilePayload | null) => void;
  accept?: string;
  label: string;
  hint?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(f: File | null) {
    if (!f) return;
    setBusy(true);
    try {
      const okTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
      if (!okTypes.includes(f.type)) { toast.error("Please upload a PDF, PNG or JPG."); return; }
      if (f.size > 4 * 1024 * 1024) { toast.error("File is larger than 4 MB."); return; }
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = () => reject(new Error("read failed"));
        r.readAsDataURL(f);
      });
      onFile({ name: f.name, contentType: f.type, dataBase64 });
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {file ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate">{file.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{Math.round(file.dataBase64.length * 0.75 / 1024)} KB</span>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onFile(null)} aria-label="Remove file">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          Choose file — PDF, PNG or JPG up to 4 MB
        </button>
      )}
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} aria-label={label} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// ── the wizard ───────────────────────────────────────────────────────────────

export default function SignupWizard({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(INITIAL);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SuccessData | null>(null);

  // subdomain availability
  const [subBusy, setSubBusy] = useState(false);
  const [subState, setSubState] = useState<{ available: boolean | null; reason: string | null; suggestions: string[] }>({ available: null, reason: null, suggestions: [] });

  const set = useCallback(<K extends keyof WizardData>(key: K, value: WizardData[K]) => {
    setData((d) => ({ ...d, [key]: value }));
    setErrors((e) => { const n = { ...e }; delete n[key as string]; return n; });
  }, []);

  const setTrustee = useCallback((i: number, patch: Partial<Trustee>) => {
    setData((d) => ({ ...d, trustees: d.trustees.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) }));
  }, []);

  // ── per-step validation (spec: block Next until THIS step is valid) ────────
  function validateStep(s: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (data.displayName.trim().length < 3) e.displayName = "Display name needs at least 3 characters.";
      if (data.registeredLegalName.trim().length < 3) e.registeredLegalName = "Required — the exact name on the CAC certificate (or intended registration).";
      if (data.preferredSubdomain && !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(data.preferredSubdomain)) {
        e.preferredSubdomain = "Lowercase letters, numbers and hyphens only.";
      } else if (data.preferredSubdomain && subState.available === false) {
        e.preferredSubdomain = subState.reason ?? "That address is taken.";
      }
      if (data.foundedOn && Number.isNaN(Date.parse(data.foundedOn))) e.foundedOn = "Not a valid date.";
    }
    if (s === 1) {
      if (data.cacRegistrationDate && Number.isNaN(Date.parse(data.cacRegistrationDate))) e.cacRegistrationDate = "Not a valid date.";
      if (data.tin && !/^\d{6,20}$/.test(data.tin.replace(/[\s-]/g, ""))) e.tin = "TIN is usually 10-14 digits.";
    }
    if (s === 2) {
      const emails = new Set<string>();
      data.trustees.forEach((t, i) => {
        if (!t.fullName.trim()) e[`trustee-${i}-fullName`] = "Full legal name is required.";
        if (t.email && !EMAIL_RE.test(t.email.trim())) e[`trustee-${i}-email`] = "Not a valid email.";
        if (t.email && emails.has(t.email.trim().toLowerCase())) e[`trustee-${i}-email`] = "Duplicate email.";
        if (t.email) emails.add(t.email.trim().toLowerCase());
      });
      if (data.trustees.filter((t) => t.fullName.trim()).length < 2) e.trusteesMin = "CAC requires at least 2 trustees — add another trustee to continue.";
    }
    if (s === 3) {
      if (data.headPastorEmail && !EMAIL_RE.test(data.headPastorEmail.trim())) e.headPastorEmail = "Not a valid email.";
      if (data.headPastorNin && !/^\d{11}$/.test(data.headPastorNin.trim())) e.headPastorNin = "NIN is 11 digits.";
    }
    if (s === 4) {
      if (data.bankAccountNumber && !/^\d{10}$/.test(data.bankAccountNumber.trim())) e.bankAccountNumber = "Nigerian bank account numbers are 10 digits (NUBAN).";
      if (data.bankAccountNumber && !data.bankName) e.bankName = "Choose the bank.";
      if (data.bankAccountNumber && !data.bankAccountName.trim()) e.bankAccountName = "Account name is required (must match the registered church name).";
    }
    if (s === 5) {
      if (!data.ndpaAcknowledged) e.ndpaAcknowledged = "The NDPA acknowledgment is required to continue.";
    }
    if (s === 6) {
      if (!data.ownerFullName.trim()) e.ownerFullName = "Owner's full name is required.";
      if (!EMAIL_RE.test(data.ownerEmail.trim())) e.ownerEmail = "A valid email is required.";
      if (data.ownerPassword.length < 8) e.ownerPassword = "At least 8 characters.";
      if (data.ownerPassword !== data.ownerPassword2) e.ownerPassword2 = "Passwords don't match.";
      if (!data.confirmAuthorized) e.confirmAuthorized = "Please confirm you are authorized to act for the trustees.";
    }
    return e;
  }

  function next() {
    const e = validateStep(step);
    setErrors(e);
    if (Object.keys(e).length) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function checkSubdomain(value: string) {
    if (!value.trim()) { setSubState({ available: null, reason: null, suggestions: [] }); return; }
    setSubBusy(true);
    try {
      const res = await api.get<{ available: boolean; reason: string | null; suggestions: string[] }>(
        `/tenants/subdomain-check?value=${encodeURIComponent(value)}`,
      );
      setSubState({ available: res.available, reason: res.reason, suggestions: res.suggestions ?? [] });
    } catch {
      setSubState({ available: null, reason: null, suggestions: [] });
    } finally {
      setSubBusy(false);
    }
  }

  async function submit() {
    const e = validateStep(6); // re-validate the critical consent/owner steps
    const e2 = validateStep(5);
    const all = { ...e2, ...e };
    if (Object.keys(all).length) { setErrors(all); toast.error("Please fix the highlighted fields."); return; }
    setSubmitting(true);
    try {
      const res = await api.post<SuccessData>("/tenants/create", {
        displayName: data.displayName.trim(),
        registeredLegalName: data.registeredLegalName.trim(),
        denomination: data.denomination || undefined,
        foundedOn: data.foundedOn || undefined,
        preferredSubdomain: data.preferredSubdomain.trim().toLowerCase() || undefined,
        cacNumber: data.cacNumber.trim() || undefined,
        cacRegistrationDate: data.cacRegistrationDate || undefined,
        cacCertificate: data.cacCertificate,
        tin: data.tin.trim() || undefined,
        scumlNumber: data.scumlNumber.trim() || undefined,
        trustees: data.trustees
          .filter((t) => t.fullName.trim())
          .map((t) => ({
            fullName: t.fullName.trim(),
            trusteeRole: t.trusteeRole || "Trustee",
            phone: t.phone.trim() || undefined,
            email: t.email.trim() || undefined,
            residentialAddress: t.residentialAddress.trim() || undefined,
            idType: t.idType || undefined,
            idNumber: t.idNumber.trim() || undefined,
            idDocument: t.idDocument,
          })),
        registeredAddressLine1: data.registeredAddressLine1.trim() || undefined,
        registeredAddressLine2: data.registeredAddressLine2.trim() || undefined,
        registeredState: data.registeredState || undefined,
        registeredLga: data.registeredLga || undefined,
        worshipSameAsRegistered: data.worshipSameAsRegistered,
        worshipAddress: data.worshipAddress.trim() || undefined,
        headPastorName: data.headPastorName.trim() || undefined,
        headPastorPhone: data.headPastorPhone.trim() || undefined,
        headPastorEmail: data.headPastorEmail.trim() || undefined,
        headPastorNin: data.headPastorNin.trim() || undefined,
        bankName: data.bankName || undefined,
        bankAccountNumber: data.bankAccountNumber.trim() || undefined,
        bankAccountName: data.bankAccountName.trim() || undefined,
        ndpaAcknowledged: data.ndpaAcknowledged,
        owner: {
          fullName: data.ownerFullName.trim(),
          email: data.ownerEmail.trim(),
          phone: data.ownerPhone.trim() || undefined,
          password: data.ownerPassword,
          confirmAuthorized: data.confirmAuthorized,
        },
        memberCountEstimate: data.memberCountEstimate ? Number(data.memberCountEstimate) : undefined,
        honeypot: data.honeypot,
      });
      setResult(res);
      toast.success("Your church account is ready.");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Signup failed — please try again.";
      toast.error(msg);
      if (err instanceof ApiError && /taken|similar/.test(msg)) setStep(0);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) return <SignupSuccess data={result} onDone={onBack} />;

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* top bar */}
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-primary-foreground">
              <Building2 className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">Create your church&apos;s account</p>
              <p className="text-xs text-muted-foreground">Nigerian-legal onboarding · CAC · NDPA</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Button>
        </div>
        <div className="h-1 w-full bg-muted">
          <div className="brand-gradient h-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 lg:flex-row">
        {/* step rail */}
        <nav aria-label="Signup steps" className="lg:w-56 lg:shrink-0">
          <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1 lg:overflow-visible">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const done = i < step;
              const current = i === step;
              return (
                <li key={s.key} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => i < step && setStep(i)}
                    disabled={i > step}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                      current && "bg-primary/10 font-medium text-primary",
                      done && "text-muted-foreground hover:bg-muted hover:text-foreground",
                      !done && !current && "text-muted-foreground/60",
                    )}
                    aria-current={current ? "step" : undefined}
                  >
                    <span className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs",
                      current && "border-primary bg-primary text-primary-foreground",
                      done && "border-emerald-500 bg-emerald-500 text-white",
                      !done && !current && "border-muted-foreground/30",
                    )}>
                      {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                    </span>
                    <span className="whitespace-nowrap">{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* step body */}
        <div className="min-w-0 flex-1">
          <Card className="border-border/70 shadow-sm">
            <CardContent className="p-5 sm:p-6">
              {step === 0 ? <IdentityStep data={data} set={set} errors={errors} subBusy={subBusy} subState={subState} onCheckSubdomain={checkSubdomain} onSubdomainEdited={() => setSubState({ available: null, reason: null, suggestions: [] })} onSubdomainPicked={(s) => { setData((d) => ({ ...d, preferredSubdomain: s })); setSubState({ available: true, reason: null, suggestions: [] }); }} /> : null}
              {step === 1 ? <LegalStep data={data} set={set} errors={errors} /> : null}
              {step === 2 ? <TrusteesStep data={data} set={set} setTrustee={setTrustee} errors={errors} /> : null}
              {step === 3 ? <AddressStep data={data} set={set} errors={errors} /> : null}
              {step === 4 ? <BankingStep data={data} set={set} errors={errors} /> : null}
              {step === 5 ? <DataProtectionStep data={data} set={set} errors={errors} /> : null}
              {step === 6 ? <OwnerStep data={data} set={set} errors={errors} /> : null}
              {step === 7 ? <ReviewStep data={data} goTo={setStep} /> : null}

              <Separator className="my-5" />
              <div className="flex items-center justify-between gap-3">
                <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || submitting}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button onClick={next}>
                    Continue <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button onClick={submit} disabled={submitting} className="min-w-56">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {submitting ? "Creating your church…" : "Create my church's account"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* anti-bot honeypot — visually hidden, real form field */}
          <div className="sr-only" aria-hidden="true">
            <label htmlFor="companyWebsite">Company website</label>
            <input id="companyWebsite" tabIndex={-1} autoComplete="off" value={data.honeypot} onChange={(e) => set("honeypot", e.target.value)} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── steps ────────────────────────────────────────────────────────────────────

type SetFn = <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;

function IdentityStep({ data, set, errors, subBusy, subState, onCheckSubdomain, onSubdomainEdited, onSubdomainPicked }: {
  data: WizardData; set: SetFn; errors: Record<string, string>;
  subBusy: boolean; subState: { available: boolean | null; reason: string | null; suggestions: string[] };
  onCheckSubdomain: (v: string) => void;
  onSubdomainEdited: () => void;
  onSubdomainPicked: (s: string) => void;
}) {
  return (
    <div className="space-y-5">
      <StepIntro title="Church identity" description="How your church appears in the app, and how it will appear on official records." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name (in-app)" error={errors.displayName} htmlFor="displayName">
          <Input id="displayName" value={data.displayName} maxLength={150} placeholder="e.g. Grace Chapel Abuja"
            onChange={(e) => { set("displayName", e.target.value); if (!data.preferredSubdomain && e.target.value.length > 2) set("preferredSubdomain", e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)); }} />
        </Field>
        <Field label="Registered legal name (CAC)" error={errors.registeredLegalName} htmlFor="legalName">
          <Input id="legalName" value={data.registeredLegalName} maxLength={255} placeholder="e.g. Grace Chapel Ministries Incorporated"
            onChange={(e) => set("registeredLegalName", e.target.value)} />
        </Field>
      </div>

      <Field label="Your unique church URL" error={errors.preferredSubdomain} hint="This is auto-generated from your display name — you can edit it. It becomes {name}.churchos.app and is reserved the moment your account is created.">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input value={data.preferredSubdomain} placeholder="grace-chapel-abuja" className="pr-32"
              onChange={(e) => { set("preferredSubdomain", e.target.value.toLowerCase()); onSubdomainEdited(); }}
              onBlur={() => onCheckSubdomain(data.preferredSubdomain)} />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">.churchos.app</span>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => onCheckSubdomain(data.preferredSubdomain)} disabled={!data.preferredSubdomain || subBusy}>
            {subBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />} Check
          </Button>
        </div>
      </Field>
      {subState.available === true ? (
        <p className="flex items-center gap-1.5 text-sm text-emerald-700"><Check className="h-4 w-4" /> Available — we&apos;ll reserve it for you.</p>
      ) : null}
      {subState.available === false ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> {subState.reason}</p>
          {subState.suggestions.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {subState.suggestions.map((s) => (
                <button key={s} type="button" onClick={() => onSubdomainPicked(s)}
                  className="rounded-full border bg-white px-2.5 py-1 text-xs font-medium hover:border-emerald-400 hover:text-emerald-700">
                  {s}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Denomination / affiliation">
          <Select value={data.denomination || undefined} onValueChange={(v) => set("denomination", v === "__other__" ? "Other" : v)}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select (optional)" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {DENOMS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              <SelectItem value="__other__">Other (type later in settings)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Date the church was founded" error={errors.foundedOn} hint="Often years before CAC incorporation — that's normal." htmlFor="foundedOn">
          <Input id="foundedOn" type="date" value={data.foundedOn} onChange={(e) => set("foundedOn", e.target.value)} />
        </Field>
      </div>
    </div>
  );
}

const DENOMS = [
  "Pentecostal", "Redeemed Christian Church of God (RCCG)", "Living Faith Church (Winners)",
  "Deeper Christian Life Ministry", "Anglican (Church of Nigeria)", "Roman Catholic",
  "Baptist", "Methodist Church Nigeria", "Presbyterian", "FourSquare Gospel Church",
  "Assemblies of God", "Celestial Church of Christ", "Cherubim & Seraphim",
  "Gospel Faith Mission", "Non-denominational",
];

function LegalStep({ data, set, errors }: { data: WizardData; set: SetFn; errors: Record<string, string> }) {
  return (
    <div className="space-y-5">
      <StepIntro title="Legal & regulatory (Nigerian compliance)" description="Churches register with the Corporate Affairs Commission as Incorporated Trustees (CAMA 2020, Part F) — not as businesses." />
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
        Don&apos;t have CAC registration yet? You can still create your account and complete this later — your account will be marked
        <strong> &ldquo;Pending verification&rdquo;</strong> until legal documents are submitted. All features except online giving work right away.
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="CAC registration number" hint="Format like IT-123456 for Incorporated Trustees; legacy formats welcome." htmlFor="cacNumber">
          <Input id="cacNumber" value={data.cacNumber} placeholder="IT-123456" onChange={(e) => set("cacNumber", e.target.value)} />
        </Field>
        <Field label="CAC registration date" error={errors.cacRegistrationDate} htmlFor="cacDate">
          <Input id="cacDate" type="date" value={data.cacRegistrationDate} onChange={(e) => set("cacRegistrationDate", e.target.value)} />
        </Field>
      </div>
      <FileField label="Certificate of Incorporation" file={data.cacCertificate} onFile={(f) => set("cacCertificate", f)} hint="Private, encrypted storage — visible only to your church admins and our compliance reviewers." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="TIN (FIRS Tax Identification Number)" error={errors.tin} htmlFor="tin" hint="Required by banks for account operation and by FIRS for compliance.">
          <Input id="tin" value={data.tin} placeholder="e.g. 1234567-8901" onChange={(e) => set("tin", e.target.value)} />
        </Field>
        <Field label="SCUML registration number" htmlFor="scuml" hint="Special Control Unit against Money Laundering — NGOs and religious bodies register under AML/CFT rules.">
          <Input id="scuml" value={data.scumlNumber} placeholder="SC-MLA-XXXXXX" onChange={(e) => set("scumlNumber", e.target.value)} />
        </Field>
      </div>
    </div>
  );
}

function TrusteesStep({ data, set, setTrustee, errors }: {
  data: WizardData; set: SetFn; setTrustee: (i: number, patch: Partial<Trustee>) => void; errors: Record<string, string>;
}) {
  function addTrustee() {
    set("trustees", [...data.trustees, { fullName: "", trusteeRole: "Trustee", phone: "", email: "", residentialAddress: "", idType: "nin", idNumber: "", idDocument: null }]);
  }
  function removeTrustee(i: number) {
    set("trustees", data.trustees.filter((_, idx) => idx !== i));
  }
  return (
    <div className="space-y-5">
      <StepIntro title="Registered trustees" description="CAC Incorporated Trustees require a minimum of 2 trustees (commonly 3-7). These are your Board of Trustees roles — different from in-app admin roles." />
      {errors.trusteesMin ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{errors.trusteesMin}</p>
      ) : null}
      <div className="space-y-4">
        {data.trustees.map((t, i) => (
          <div key={i} className="rounded-xl border p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">Trustee {i + 1}</p>
              {data.trustees.length > 2 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => removeTrustee(i)}>
                  <Trash2 className="h-4 w-4 text-destructive" /> Remove
                </Button>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full legal name" error={errors[`trustee-${i}-fullName`]}>
                <Input value={t.fullName} onChange={(e) => setTrustee(i, { fullName: e.target.value })} placeholder="As on their ID" />
              </Field>
              <Field label="Role on the Board">
                <Select value={t.trusteeRole} onValueChange={(v) => setTrustee(i, { trusteeRole: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Chairman", "Secretary", "Treasurer", "Trustee", "Member"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Phone">
                <Input value={t.phone} onChange={(e) => setTrustee(i, { phone: e.target.value })} placeholder="+234 …" type="tel" />
              </Field>
              <Field label="Email" error={errors[`trustee-${i}-email`]}>
                <Input value={t.email} onChange={(e) => setTrustee(i, { email: e.target.value })} type="email" />
              </Field>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Residential address">
                <Textarea value={t.residentialAddress} onChange={(e) => setTrustee(i, { residentialAddress: e.target.value })} rows={2} className="resize-none" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Means of ID">
                  <Select value={t.idType || undefined} onValueChange={(v) => setTrustee(i, { idType: v })}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nin">National ID (NIN)</SelectItem>
                      <SelectItem value="international_passport">International Passport</SelectItem>
                      <SelectItem value="voters_card">Voter&apos;s Card</SelectItem>
                      <SelectItem value="drivers_license">Driver&apos;s License</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="ID number" hint="Encrypted at rest.">
                  <Input value={t.idNumber} onChange={(e) => setTrustee(i, { idNumber: e.target.value })} />
                </Field>
              </div>
            </div>
            <div className="mt-4">
              <FileField label="ID document (optional)" file={t.idDocument} onFile={(f) => setTrustee(i, { idDocument: f })} />
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" onClick={addTrustee} className="w-full border-dashed">
        <Users className="h-4 w-4" /> Add trustee
      </Button>
    </div>
  );
}

function AddressStep({ data, set, errors }: { data: WizardData; set: SetFn; errors: Record<string, string> }) {
  return (
    <div className="space-y-5">
      <StepIntro title="Address & leadership" description="The official registered address (as filed with CAC) plus your worship location and senior leader." />
      <div className="space-y-4">
        <Field label="Registered address — line 1" htmlFor="regAddr1">
          <Input id="regAddr1" value={data.registeredAddressLine1} placeholder="Street address" onChange={(e) => set("registeredAddressLine1", e.target.value)} />
        </Field>
        <Field label="Registered address — line 2" htmlFor="regAddr2">
          <Input id="regAddr2" value={data.registeredAddressLine2} onChange={(e) => set("registeredAddressLine2", e.target.value)} />
        </Field>
        <NigerianStateLgaSelect
          idPrefix="registered"
          state={data.registeredState}
          lga={data.registeredLga}
          onState={(v) => { set("registeredState", v); set("registeredLga", ""); }}
          onLga={(v) => set("registeredLga", v)}
        />
      </div>
      <Separator />
      <div className="flex items-start gap-3">
        <Checkbox id="sameAddr" checked={data.worshipSameAsRegistered} onCheckedChange={(v) => set("worshipSameAsRegistered", v === true)} />
        <div>
          <Label htmlFor="sameAddr" className="cursor-pointer">The worship address is the same as the registered address</Label>
          <p className="text-xs text-muted-foreground">Uncheck to enter the physical church/worship address (you can add more campuses later).</p>
        </div>
      </div>
      {!data.worshipSameAsRegistered ? (
        <Field label="Physical church / worship address" htmlFor="worshipAddr">
          <Input id="worshipAddr" value={data.worshipAddress} onChange={(e) => set("worshipAddress", e.target.value)} placeholder="Street address, city" />
        </Field>
      ) : null}
      <Separator />
      <p className="text-sm font-medium">Head Pastor / General Overseer</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="hpName">
          <Input id="hpName" value={data.headPastorName} onChange={(e) => set("headPastorName", e.target.value)} />
        </Field>
        <Field label="Phone" htmlFor="hpPhone">
          <Input id="hpPhone" type="tel" value={data.headPastorPhone} onChange={(e) => set("headPastorPhone", e.target.value)} placeholder="+234 …" />
        </Field>
        <Field label="Email" error={errors.headPastorEmail} htmlFor="hpEmail">
          <Input id="hpEmail" type="email" value={data.headPastorEmail} onChange={(e) => set("headPastorEmail", e.target.value)} />
        </Field>
        <Field label="NIN (11 digits)" error={errors.headPastorNin} htmlFor="hpNin" hint="Increasingly required for bank KYC. Encrypted at rest — never shown in full.">
          <Input id="hpNin" value={data.headPastorNin} onChange={(e) => set("headPastorNin", e.target.value.replace(/[^\d]/g, "").slice(0, 11))} inputMode="numeric" />
        </Field>
      </div>
    </div>
  );
}

function BankingStep({ data, set, errors }: { data: WizardData; set: SetFn; errors: Record<string, string> }) {
  return (
    <div className="space-y-5">
      <StepIntro title="Church bank account" description="Optional at signup — but online giving stays locked until the settlement account is on file (CBN/bank KYC requires the account name to match the registered church name)." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bank name">
          <Select value={data.bankName || undefined} onValueChange={(v) => set("bankName", v)}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select a bank" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {BANKS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Account number (10 digits)" error={errors.bankAccountNumber} htmlFor="acctNum">
          <Input id="acctNum" value={data.bankAccountNumber} inputMode="numeric" maxLength={10}
            onChange={(e) => set("bankAccountNumber", e.target.value.replace(/[^\d]/g, "").slice(0, 10))} placeholder="0123456789" />
        </Field>
      </div>
      <Field label="Account name" error={errors.bankAccountName} htmlFor="acctName" hint="Must match the registered church name per CBN KYC rules.">
        <Input id="acctName" value={data.bankAccountName} onChange={(e) => set("bankAccountName", e.target.value)} />
      </Field>
      <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
        The account number is encrypted at rest with AES-256-GCM before it touches the database, is never written to logs or audit
        snapshots, and is used solely as the settlement account for member giving.
      </p>
    </div>
  );
}

const BANKS = [
  "Access Bank", "Citibank Nigeria", "Ecobank Nigeria", "Fidelity Bank", "First Bank of Nigeria",
  "First City Monument Bank (FCMB)", "Globus Bank", "Jaiz Bank", "Keystone Bank", "Kuda Microfinance Bank",
  "Moniepoint MFB", "OPay Digital Services", "PalmPay", "Parallex Bank", "Polaris Bank", "Providus Bank",
  "Signature Bank", "Stanbic IBTC Bank", "Standard Chartered", "Sterling Bank", "SunTrust Bank",
  "TAJ Bank", "Titan Trust Bank", "Union Bank of Nigeria", "United Bank for Africa (UBA)", "Unity Bank",
  "Wema Bank", "Zenith Bank",
];

function DataProtectionStep({ data, set, errors }: { data: WizardData; set: SetFn; errors: Record<string, string> }) {
  return (
    <div className="space-y-5">
      <StepIntro title="Data protection (NDPA 2023)" description="Plain-language summary of what the Nigeria Data Protection Act means for your church on ChurchOS." />
      <ul className="space-y-2 rounded-lg border bg-muted/30 p-4 text-sm">
        {DPA_POINTS.map((p, i) => (
          <li key={i} className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><span>{p}</span></li>
        ))}
      </ul>
      <div className={cn("flex items-start gap-3 rounded-lg border p-4", errors.ndpaAcknowledged ? "border-destructive/40" : "")}>
        <Checkbox id="ndpa" checked={data.ndpaAcknowledged} onCheckedChange={(v) => set("ndpaAcknowledged", v === true)} />
        <div>
          <Label htmlFor="ndpa" className="cursor-pointer leading-relaxed">
            I confirm that <strong>{data.registeredLegalName.trim() || "the church"}</strong> will act as Data Controller for member
            information entered into this system, and we accept the{" "}
            <span className="font-medium underline underline-offset-2">Data Processing Agreement (DPA {DPA_VERSION})</span> on those terms.
          </Label>
          {errors.ndpaAcknowledged ? <p className="mt-1 text-xs text-destructive" role="alert">{errors.ndpaAcknowledged}</p> : null}
          <p className="mt-1 text-xs text-muted-foreground">If the DPA terms change, owners will be asked to re-accept the new version — the accepted version is recorded with a timestamp.</p>
        </div>
      </div>
    </div>
  );
}

const DPA_POINTS = [
  "Your church is the Data Controller: it decides why and how member data (records, giving, minors' data) is processed.",
  "ChurchOS acts as the Data Processor and processes member data only on your instructions to deliver the service.",
  "Members keep NDPA rights — access, correction, and deletion requests can be handled from the People module.",
  "Minors' data gets extra care: children are linked to guardians and check-in uses security codes.",
  "Data is encrypted in transit and sensitive identifiers (IDs, bank details) are encrypted at rest.",
  "Breaches affecting personal data must be reported to NDPC and affected members within 72 hours.",
];

function OwnerStep({ data, set, errors }: { data: WizardData; set: SetFn; errors: Record<string, string> }) {
  return (
    <div className="space-y-5">
      <StepIntro title="Owner account" description="The first administrator — usually the point person the trustees authorized. Owner has full access, including roles & permissions." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={errors.ownerFullName} htmlFor="ownerName">
          <Input id="ownerName" value={data.ownerFullName} onChange={(e) => set("ownerFullName", e.target.value)} />
        </Field>
        <Field label="Phone" htmlFor="ownerPhone">
          <Input id="ownerPhone" type="tel" value={data.ownerPhone} onChange={(e) => set("ownerPhone", e.target.value)} placeholder="+234 …" />
        </Field>
        <Field label="Email (this is the sign-in email)" error={errors.ownerEmail} htmlFor="ownerEmail">
          <Input id="ownerEmail" type="email" value={data.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} placeholder="you@yourchurch.org" />
        </Field>
        <Field label="Password (min 8 characters)" error={errors.ownerPassword} htmlFor="ownerPassword">
          <Input id="ownerPassword" type="password" value={data.ownerPassword} onChange={(e) => set("ownerPassword", e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Confirm password" error={errors.ownerPassword2} htmlFor="ownerPassword2">
          <Input id="ownerPassword2" type="password" value={data.ownerPassword2} onChange={(e) => set("ownerPassword2", e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
      <div className={cn("flex items-start gap-3 rounded-lg border p-4", errors.confirmAuthorized ? "border-destructive/40" : "")}>
        <Checkbox id="authorized" checked={data.confirmAuthorized} onCheckedChange={(v) => set("confirmAuthorized", v === true)} />
        <Label htmlFor="authorized" className="cursor-pointer leading-relaxed">
          I confirm I am authorized by the registered trustees to create and administer this account on their behalf.
        </Label>
      </div>
      {errors.confirmAuthorized ? <p className="text-xs text-destructive" role="alert">{errors.confirmAuthorized}</p> : null}
    </div>
  );
}

function ReviewStep({ data, goTo }: { data: WizardData; goTo: (s: number) => void }) {
  const trustees = data.trustees.filter((t) => t.fullName.trim());
  const rows: { label: string; value: React.ReactNode; step: number }[] = [
    { label: "Display name", value: data.displayName || "—", step: 0 },
    { label: "Registered legal name", value: data.registeredLegalName || "—", step: 0 },
    { label: "Church URL", value: data.preferredSubdomain ? `${data.preferredSubdomain}.churchos.app` : "Auto-generate", step: 0 },
    { label: "Denomination", value: data.denomination || "—", step: 0 },
    { label: "Founded", value: data.foundedOn || "—", step: 0 },
    { label: "CAC number", value: data.cacNumber || "Not yet registered", step: 1 },
    { label: "CAC certificate", value: data.cacCertificate ? data.cacCertificate.name : "Not uploaded", step: 1 },
    { label: "TIN / SCUML", value: [data.tin, data.scumlNumber].filter(Boolean).join(" · ") || "—", step: 1 },
    { label: "Trustees", value: `${trustees.length} entered (min 2)`, step: 2 },
    { label: "Registered address", value: [data.registeredAddressLine1, data.registeredLga, data.registeredState].filter(Boolean).join(", ") || "—", step: 3 },
    { label: "Head pastor", value: data.headPastorName || "—", step: 3 },
    { label: "Bank account", value: data.bankName ? `${data.bankName} · •••${data.bankAccountNumber.slice(-3)}` : "Added later", step: 4 },
    { label: "NDPA / DPA", value: data.ndpaAcknowledged ? `Accepted (DPA ${DPA_VERSION})` : "Not accepted", step: 5 },
    { label: "Owner email", value: data.ownerEmail || "—", step: 6 },
  ];
  return (
    <div className="space-y-5">
      <StepIntro title="Review & submit" description="One last look. Everything below is submitted together in a single atomic step — either the whole church account is created or nothing is." />
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.label} className={cn("border-b last:border-b-0", i % 2 ? "bg-muted/30" : "")}>
                <td className="w-44 px-3 py-2 align-top text-muted-foreground">{r.label}</td>
                <td className="px-3 py-2"><span className="block break-words">{r.value}</span></td>
                <td className="w-16 px-2 py-2 text-right align-top">
                  <button type="button" onClick={() => goTo(r.step)} className="text-xs font-medium text-primary hover:underline">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        ID numbers, NINs and bank details are encrypted before storage and are excluded from audit snapshots in readable form.
      </p>
    </div>
  );
}

function StepIntro({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
