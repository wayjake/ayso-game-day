import type { Route } from "./+types/team.money.invoices";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { data, useFetcher } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { invoicePreview, payPath, saveInvoiceTemplate, sendInvoices, teamInvoices } from "~/utils/billing.server";
import { FormError, newFormKey, runLedgerAction } from "~/utils/ledger-forms.server";
import { formatCents } from "~/utils/money";
import {
  BODY_MAX,
  DEFAULT_INVOICE_BODY,
  DEFAULT_INVOICE_SUBJECT,
  INVOICE_PLACEHOLDERS,
  SUBJECT_MAX,
  cleanTemplate,
  invoiceLineLabel,
  renderInvoiceEmail,
} from "~/utils/invoice-email";
import { Amount } from "~/components/money";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Page, PageHeader, cx, hintClass, inputClass, labelClass } from "~/components/ui";
import { ArrowCounterClockwise, CaretDown, CheckCircle, EnvelopeSimple, Eye, Invoice, LinkSimple, PaperPlaneTilt, WarningCircle } from "@phosphor-icons/react";
import { teamIdFromCode } from "~/utils/team-access.server";
import { teamPath } from "~/utils/team-path";
import { appOrigin, latestReceiptPreview, saveReceiptTemplate } from "~/utils/receipts.server";
import {
  DEFAULT_RECEIPT_BODY,
  DEFAULT_RECEIPT_SUBJECT,
  RECEIPT_PLACEHOLDERS,
  cleanReceiptTemplate,
  renderReceiptEmail,
  type ReceiptEmailData,
} from "~/utils/receipt-email";
import { todayISO } from "~/utils/dates";

export function meta() {
  return [{ title: "Invoices - Finances - BenchTalk" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess((await teamIdFromCode(params.teamCode)), user.id);
  const [preview, sent] = await Promise.all([invoicePreview(team.id), teamInvoices(team.id)]);
  const origin = appOrigin(request);
  const coachName = user.name || user.email.split("@")[0];
  return data({
    teamId: team.id,
    teamCode: team.code,
    teamName: team.name,
    coachName: user.name || user.email.split("@")[0],
    formKey: newFormKey(),
    template: { subject: team.invoiceEmailSubject ?? DEFAULT_INVOICE_SUBJECT, body: team.invoiceEmailBody ?? DEFAULT_INVOICE_BODY },
    preview: {
      ...preview,
      drafts: preview.drafts.map((d) => ({ ...d, payUrl: `${origin}${payPath(team.id, d.familyKey) ?? "/pay/…"}` })),
    },
    sampleUrl: `${origin}/pay/…`,
    sent,
    receiptTemplate: { subject: team.receiptEmailSubject ?? DEFAULT_RECEIPT_SUBJECT, body: team.receiptEmailBody ?? DEFAULT_RECEIPT_BODY },
    receiptLatest: await latestReceiptPreview(team.id, coachName, origin),
    receiptSample: {
      team: team.name,
      coach: coachName,
      family: "Alex Sample",
      players: ["Alex Sample"],
      cents: 8500,
      method: "Venmo",
      date: todayISO(),
      balanceCents: 0,
      payUrl: `${origin}/pay/…`,
    },
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const { team } = await requireTeamAccess((await teamIdFromCode(params.teamCode)), user.id);
  const formData = await request.formData();
  const intent = formData.get("_action");
  const template = () => cleanTemplate(String(formData.get("subject") ?? ""), String(formData.get("body") ?? ""));

  if (intent === "saveReceiptEmail") {
    return runLedgerAction(() => saveReceiptTemplate(team.id, cleanReceiptTemplate(String(formData.get("subject") ?? ""), String(formData.get("body") ?? ""))));
  }
  if (intent === "saveEmail") {
    return runLedgerAction(() => saveInvoiceTemplate(team.id, template()));
  }
  if (intent === "send") {
    return runLedgerAction(async () => {
      const key = String(formData.get("sendKey") ?? "");
      if (!key) throw new FormError("Reload the page and try again");
      const families = formData.getAll("family").map(String).filter(Boolean);
      if (families.length === 0) throw new FormError("Pick at least one family to send to");
      // What's in the editor is what goes out
      await saveInvoiceTemplate(team.id, template());
      await sendInvoices(team.id, user.id, key, appOrigin(request), families);
    });
  }
  return data({ ok: false as const, error: "Unknown action" }, { status: 400 });
}

type Draft = Route.ComponentProps["loaderData"]["preview"]["drafts"][number];

export default function Invoices({ loaderData }: Route.ComponentProps) {
  const { teamCode, teamName, coachName, formKey, template, preview, sampleUrl, sent, receiptTemplate, receiptLatest, receiptSample } = loaderData;
  const base = teamPath(teamCode, "finances");
  const drafts = preview.drafts;

  // Every family is picked until the coach unticks them; a new set of drafts (after a send) starts over
  const draftKeys = drafts.map((d) => d.familyKey).join("|");
  const [picked, setPicked] = useState(() => new Set(drafts.map((d) => d.familyKey)));
  const [previewKey, setPreviewKey] = useState(drafts[0]?.familyKey ?? "");
  useEffect(() => {
    setPicked(new Set(drafts.map((d) => d.familyKey)));
    setPreviewKey((k) => (drafts.some((d) => d.familyKey === k) ? k : drafts[0]?.familyKey ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKeys]);

  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const chosen = drafts.filter((d) => picked.has(d.familyKey));
  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Page>
      <PageHeader
        back={{ to: base, label: "Finances" }}
        title="Invoices"
        description="One bill per family, with every share not yet invoiced, for all their kids. Each family gets it by email with a link to pay on Venmo, no sign-in needed. Once sent, an invoice never changes: anything later goes on the next one."
      />

      <section>
        <CardHeader
          title="Ready to send"
          count={drafts.length}
          className="mb-3"
          actions={
            drafts.length > 1 ? (
              <button
                type="button"
                className="tap text-sm font-semibold text-primary hover:underline"
                onClick={() => setPicked(chosen.length === drafts.length ? new Set() : new Set(drafts.map((d) => d.familyKey)))}
              >
                {chosen.length === drafts.length ? "Pick none" : "Pick all"}
              </button>
            ) : undefined
          }
        />
        {drafts.length === 0 ? (
          <Card>
            <EmptyState icon={<Invoice size={24} />} title="Nothing to invoice">
              When you add an expense or change who shares one, it shows up here until you send it.
            </EmptyState>
          </Card>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {drafts.map((d) => (
              <DraftCard
                key={d.familyKey}
                draft={d}
                picked={picked.has(d.familyKey)}
                onToggle={() => toggle(d.familyKey)}
                onPreview={() => {
                  setPreviewKey(d.familyKey);
                  document.getElementById("invoice-email")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <EmailSection
        drafts={drafts}
        chosen={chosen}
        nextNumber={preview.nextNumber}
        previewKey={previewKey}
        setPreviewKey={setPreviewKey}
        subject={subject}
        setSubject={setSubject}
        body={body}
        setBody={setBody}
        saved={template}
        teamName={teamName}
        coachName={coachName}
        sampleUrl={sampleUrl}
      />

      {drafts.length > 0 && <SendBar formKey={formKey} chosen={chosen} subject={subject} body={body} />}

      <ReceiptEmailSection saved={receiptTemplate} sample={receiptLatest ?? receiptSample} real={Boolean(receiptLatest)} />

      <section className="mt-10">
        <CardHeader title="Sent" count={sent.length} className="mb-3" />
        {sent.length === 0 ? (
          <p className="text-sm text-muted">No invoices sent yet.</p>
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {sent.map((inv) => (
                <SentRow key={inv.id} inv={inv} />
              ))}
            </ul>
          </Card>
        )}
      </section>
    </Page>
  );
}

function DraftCard({ draft: d, picked, onToggle, onPreview }: { draft: Draft; picked: boolean; onToggle: () => void; onPreview: () => void }) {
  const staff = d.familyKey.startsWith("staff:");
  return (
    <li>
      <Card className={cx("h-full p-4 transition", !picked && "opacity-60")}>
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={picked} onChange={onToggle} className="mt-0.5" aria-label={`Send to ${d.familyName}`} />
          <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
            <span className="min-w-0 font-semibold">{d.familyName}</span>
            <Amount cents={d.totalCents} className="font-semibold" />
          </span>
        </label>
        <ul className="mt-2 space-y-1 pl-9 text-sm">
          {d.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-3 text-muted">
              <span className="min-w-0">
                {l.label}
                {d.lines.some((o) => o.who !== l.who) && <span className="text-subtle"> · {l.who.split(" ")[0]}</span>}
              </span>
              <Amount cents={l.cents} />
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pl-9 text-xs">
          {staff ? (
            <span className="text-muted">Staff: they see it in the app, no email</span>
          ) : d.emails.length === 0 ? (
            <span className="inline-flex items-center gap-1 font-medium text-warning">
              <WarningCircle size={14} weight="fill" />
              No parent email on file, so no email goes out
            </span>
          ) : (
            <span className="min-w-0 truncate text-muted">To {d.emails.join(", ")}</span>
          )}
          {!staff && (
            <button type="button" onClick={onPreview} className="tap inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              <Eye size={14} />
              Preview email
            </button>
          )}
        </div>
      </Card>
    </li>
  );
}

function EmailSection({
  drafts,
  chosen,
  nextNumber,
  previewKey,
  setPreviewKey,
  subject,
  setSubject,
  body,
  setBody,
  saved,
  teamName,
  coachName,
  sampleUrl,
}: {
  drafts: Draft[];
  chosen: Draft[];
  nextNumber: number;
  previewKey: string;
  setPreviewKey: (key: string) => void;
  subject: string;
  setSubject: (s: string) => void;
  body: string;
  setBody: (s: string) => void;
  saved: { subject: string; body: string };
  teamName: string;
  coachName: string;
  sampleUrl: string;
}) {
  const save = useFetcher<{ ok?: boolean; error?: string }>();
  const emailable = drafts.filter((d) => !d.familyKey.startsWith("staff:"));
  const draft = emailable.find((d) => d.familyKey === previewKey) ?? emailable[0] ?? null;
  const dirty = subject !== saved.subject || body !== saved.body;

  // The number it'll get: invoices are numbered in this order among the picked families
  const index = draft ? chosen.findIndex((d) => d.familyKey === draft.familyKey) : -1;
  const email = useMemo(() => {
    const several = draft ? new Set(draft.lines.map((l) => l.who)).size > 1 : false;
    return renderInvoiceEmail(
      { subject, body },
      draft
        ? {
            team: teamName,
            coach: coachName,
            number: nextNumber + (index >= 0 ? index : chosen.length),
            family: draft.familyName,
            players: draft.players,
            lines: draft.lines.map((l) => ({ label: invoiceLineLabel(l.label, l.who, several), cents: l.cents })),
            totalCents: draft.totalCents,
            balanceCents: draft.balanceCents,
            payUrl: draft.payUrl,
          }
        : {
            team: teamName,
            coach: coachName,
            number: nextNumber,
            family: "Alex Sample",
            players: ["Alex Sample"],
            lines: [{ label: "Tournament entry", cents: 11600 }],
            totalCents: 11600,
            balanceCents: 11600,
            payUrl: sampleUrl,
          }
    );
  }, [subject, body, draft, index, chosen.length, nextNumber, teamName, coachName, sampleUrl]);

  const { subjectRef, bodyRef, lastField, insert } = usePlaceholderInsert(subject, setSubject, body, setBody);

  return (
    <section id="invoice-email" className="mt-10 scroll-mt-24">
      <CardHeader title="Invoice email" className="mb-3" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <save.Form method="post" className="space-y-4">
            <input type="hidden" name="_action" value="saveEmail" />
            <div>
              <label htmlFor="email-subject" className={labelClass}>Subject</label>
              <input
                id="email-subject"
                ref={subjectRef}
                name="subject"
                value={subject}
                maxLength={SUBJECT_MAX}
                onChange={(e) => setSubject(e.target.value)}
                onFocus={() => (lastField.current = "subject")}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="email-body" className={labelClass}>Message</label>
              <textarea
                id="email-body"
                ref={bodyRef}
                name="body"
                value={body}
                maxLength={BODY_MAX}
                rows={14}
                onChange={(e) => setBody(e.target.value)}
                onFocus={() => (lastField.current = "body")}
                className={cx(inputClass, "font-mono text-sm leading-relaxed")}
              />
              <p className={hintClass}>The same email goes to every family, with their own details filled in. A blank line starts a new paragraph.</p>
            </div>
            <div>
              <p className={labelClass}>Insert</p>
              <div className="flex flex-wrap gap-2">
                {INVOICE_PLACEHOLDERS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    title={p.hint}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insert(p.key)}
                    className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-ink ring-1 ring-line hover:ring-primary pointer-coarse:py-2.5"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className={hintClass}>Line items, the amount due and the pay button are filled in for each family. The pay button is added at the end if you leave it out.</p>
            </div>
            {save.data?.error && <Alert>{save.data.error}</Alert>}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!dirty || save.state !== "idle"}>
                {save.state !== "idle" ? "Saving…" : "Save email"}
              </Button>
              {(subject !== DEFAULT_INVOICE_SUBJECT || body !== DEFAULT_INVOICE_BODY) && (
                <button
                  type="button"
                  onClick={() => {
                    setSubject(DEFAULT_INVOICE_SUBJECT);
                    setBody(DEFAULT_INVOICE_BODY);
                  }}
                  className="tap inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
                >
                  <ArrowCounterClockwise size={16} />
                  Back to the default
                </button>
              )}
              <span className="text-sm text-muted">
                {dirty ? "Not saved yet. Sending saves it too." : save.data?.ok ? "Saved" : ""}
              </span>
            </div>
          </save.Form>
        </Card>

        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <EnvelopeSimple size={18} className="text-muted" />
            {emailable.length > 1 ? (
              <>
                <label htmlFor="preview-family" className="text-sm font-medium">Preview for</label>
                <select id="preview-family" value={draft?.familyKey ?? ""} onChange={(e) => setPreviewKey(e.target.value)} className={cx(inputClass, "w-auto min-w-0 flex-1")}>
                  {emailable.map((d) => (
                    <option key={d.familyKey} value={d.familyKey}>
                      {d.familyName}
                      {chosen.some((c) => c.familyKey === d.familyKey) ? "" : " (not picked)"}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <p className="text-sm font-medium">{draft ? `Preview for ${draft.familyName}` : "Preview with a sample family"}</p>
            )}
          </div>
          <dl className="mt-3 space-y-1 border-b border-line pb-3 text-sm">
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-muted">To</dt>
              <dd className="min-w-0 break-words">{draft ? (draft.emails.length ? draft.emails.join(", ") : <span className="text-warning">No parent email on file</span>) : "Each family's parents"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-muted">Subject</dt>
              <dd className="min-w-0 break-words font-semibold">{email.subject}</dd>
            </div>
          </dl>
          {/* Built by renderInvoiceEmail, which escapes everything the coach typed */}
          <div className="mt-3 overflow-x-auto rounded-xl bg-white p-4 text-slate-900 ring-1 ring-line" dangerouslySetInnerHTML={{ __html: email.html }} />
          {draft && index < 0 && <p className={hintClass}>This family isn't picked, so they won't get it this time.</p>}
        </Card>
      </div>
    </section>
  );
}

// The receipt families get once a payment is recorded: the team's words, previewed with its latest payment
function ReceiptEmailSection({ saved, sample, real }: { saved: { subject: string; body: string }; sample: ReceiptEmailData; real: boolean }) {
  const save = useFetcher<{ ok?: boolean; error?: string }>();
  const [subject, setSubject] = useState(saved.subject);
  const [body, setBody] = useState(saved.body);
  const { subjectRef, bodyRef, lastField, insert } = usePlaceholderInsert(subject, setSubject, body, setBody);
  const dirty = subject !== saved.subject || body !== saved.body;
  const email = useMemo(() => renderReceiptEmail({ subject, body }, sample), [subject, body, sample]);

  return (
    <section id="receipt-email" className="mt-10 scroll-mt-24">
      <CardHeader title="Receipt email" className="mb-1" />
      <p className="mb-3 text-sm text-muted">
        Families get it when you record a Venmo payment from Payments to confirm, when you tick “Email the family a receipt” on a payment, or when you send one later from their page.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <save.Form method="post" className="space-y-4">
            <input type="hidden" name="_action" value="saveReceiptEmail" />
            <div>
              <label htmlFor="receipt-subject" className={labelClass}>Subject</label>
              <input
                id="receipt-subject"
                ref={subjectRef}
                name="subject"
                value={subject}
                maxLength={SUBJECT_MAX}
                onChange={(e) => setSubject(e.target.value)}
                onFocus={() => (lastField.current = "subject")}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="receipt-body" className={labelClass}>Message</label>
              <textarea
                id="receipt-body"
                ref={bodyRef}
                name="body"
                value={body}
                maxLength={BODY_MAX}
                rows={12}
                onChange={(e) => setBody(e.target.value)}
                onFocus={() => (lastField.current = "body")}
                className={cx(inputClass, "font-mono text-sm leading-relaxed")}
              />
              <p className={hintClass}>A blank line starts a new paragraph. It never says who paid or shows your staff notes.</p>
            </div>
            <div>
              <p className={labelClass}>Insert</p>
              <div className="flex flex-wrap gap-2">
                {RECEIPT_PLACEHOLDERS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    title={p.hint}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insert(p.key)}
                    className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-ink ring-1 ring-line hover:ring-primary pointer-coarse:py-2.5"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {save.data?.error && <Alert>{save.data.error}</Alert>}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!dirty || save.state !== "idle"}>
                {save.state !== "idle" ? "Saving…" : "Save receipt email"}
              </Button>
              {(subject !== DEFAULT_RECEIPT_SUBJECT || body !== DEFAULT_RECEIPT_BODY) && (
                <button
                  type="button"
                  onClick={() => {
                    setSubject(DEFAULT_RECEIPT_SUBJECT);
                    setBody(DEFAULT_RECEIPT_BODY);
                  }}
                  className="tap inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
                >
                  <ArrowCounterClockwise size={16} />
                  Back to the default
                </button>
              )}
              <span className="text-sm text-muted">{dirty ? "Not saved yet." : save.data?.ok ? "Saved" : ""}</span>
            </div>
          </save.Form>
        </Card>

        <Card className="p-4">
          <p className="flex items-center gap-3 text-sm font-medium">
            <EnvelopeSimple size={18} className="text-muted" />
            {real ? `Preview with ${sample.family}'s latest payment` : "Preview with a sample payment"}
          </p>
          <dl className="mt-3 space-y-1 border-b border-line pb-3 text-sm">
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-muted">Subject</dt>
              <dd className="min-w-0 break-words font-semibold">{email.subject}</dd>
            </div>
          </dl>
          {/* Built by renderReceiptEmail, which escapes everything the coach typed */}
          <div className="mt-3 overflow-x-auto rounded-xl bg-white p-4 text-slate-900 ring-1 ring-line" dangerouslySetInnerHTML={{ __html: email.html }} />
        </Card>
      </div>
    </section>
  );
}

// Insert-a-placeholder buttons: put {key} where the cursor was, in whichever field had it last
function usePlaceholderInsert(subject: string, setSubject: (s: string) => void, body: string, setBody: (s: string) => void) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const lastField = useRef<"subject" | "body">("body");
  // Put the cursor after what was inserted, once React has written the new value
  const caret = useRef<{ field: HTMLInputElement | HTMLTextAreaElement | null; at: number } | null>(null);
  useLayoutEffect(() => {
    const c = caret.current;
    if (!c?.field) return;
    caret.current = null;
    c.field.focus();
    c.field.setSelectionRange(c.at, c.at);
  }, [subject, body]);
  function insert(key: string) {
    const token = `{${key}}`;
    const field = lastField.current === "subject" ? subjectRef.current : bodyRef.current;
    const value = lastField.current === "subject" ? subject : body;
    const set = lastField.current === "subject" ? setSubject : setBody;
    const start = field?.selectionStart ?? value.length;
    const end = field?.selectionEnd ?? value.length;
    caret.current = { field, at: start + token.length };
    set(value.slice(0, start) + token + value.slice(end));
  }
  return { subjectRef, bodyRef, lastField, insert };
}

function SendBar({ formKey, chosen, subject, body }: { formKey: string; chosen: Draft[]; subject: string; body: string }) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  // A second tap confirms, since sending notifies every family on it
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  useEffect(() => setArmed(false), [chosen.length]);
  const busy = fetcher.state !== "idle";
  const count = chosen.length;
  const totalCents = chosen.reduce((a, d) => a + d.totalCents, 0);
  return (
    <fetcher.Form method="post" className="sticky bottom-4 z-10 mt-6">
      <input type="hidden" name="_action" value="send" />
      <input type="hidden" name="sendKey" value={formKey} />
      <input type="hidden" name="subject" value={subject} />
      <input type="hidden" name="body" value={body} />
      {chosen.map((d) => (
        <input key={d.familyKey} type="hidden" name="family" value={d.familyKey} />
      ))}
      {fetcher.data?.error && <Alert className="mb-3">{fetcher.data.error}</Alert>}
      <Card className="flex flex-wrap items-center gap-3 p-4 shadow-lg">
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">
            {count === 0 ? "No families picked" : `${count} ${count === 1 ? "invoice" : "invoices"} · ${formatCents(totalCents)}`}
          </span>
          <span className="block text-muted">Each picked family gets the email above with a link to pay, no sign-in needed. Parents on the app get a notification too.</span>
        </p>
        <Button
          type="submit"
          variant={armed ? "danger" : "primary"}
          disabled={busy || count === 0}
          onClick={(e) => {
            if (!armed) {
              e.preventDefault();
              setArmed(true);
            }
          }}
        >
          <PaperPlaneTilt size={18} />
          {busy ? "Sending…" : armed ? "Tap again to send" : `Send ${count === 1 ? "it" : `${count}`}`}
        </Button>
      </Card>
    </fetcher.Form>
  );
}

type Sent = Route.ComponentProps["loaderData"]["sent"][number];

// The family's no-sign-in page, to text them; it's also in their invoice email
function CopyPayLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(`${window.location.origin}${path}`).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="tap mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
    >
      {copied ? <CheckCircle size={16} weight="fill" /> : <LinkSimple size={16} />}
      {copied ? "Copied" : "Copy pay link"}
    </button>
  );
}

function SentRow({ inv }: { inv: Sent }) {
  const status =
    inv.totalCents <= 0 ? <Badge tone="success">Money back</Badge>
    : inv.remaining === 0 ? <Badge tone="success">Paid</Badge>
    : inv.paid > 0 ? <Badge tone="warning">{formatCents(inv.remaining)} left</Badge>
    : <Badge tone="danger">Due</Badge>;
  return (
    <li>
      <details className="group">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
          <span className="w-10 shrink-0 text-muted tabular">#{inv.number}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{inv.familyName}</span>
            <span className="block text-xs text-muted">{inv.issuedAt.slice(0, 10)}</span>
          </span>
          {status}
          <Amount cents={inv.totalCents} className="w-20 text-right font-semibold" />
          <CaretDown size={16} className="shrink-0 text-muted transition group-open:rotate-180" aria-hidden />
        </summary>
        <div className="border-t border-line bg-surface-2 px-4 py-3 text-sm">
          <ul className="space-y-1">
            {inv.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="min-w-0 text-muted">{l.label}</span>
                <Amount cents={l.cents} />
              </li>
            ))}
          </ul>
          {inv.payPath && <CopyPayLink path={inv.payPath} />}
        </div>
      </details>
    </li>
  );
}
