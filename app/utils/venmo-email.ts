// Reading Venmo's "paid you" emails, which a coach's inbox forwards to the
// team's Venmo address, and the Gmail confirmation that setting up the
// forward sends there. Pure: no imports, unit tested in venmo-email.test.ts.

export const VENMO_SENDER = "venmo@venmo.com";
export const GMAIL_FORWARDING_SENDER = "forwarding-noreply@google.com";

// The address is venmo-<token>@<sending domain>. The token is random per
// team, so nobody can guess another team's address.
export const VENMO_TOKEN_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const VENMO_TOKEN_LENGTH = 12;

export function venmoForwardAddress(token: string, domain: string) {
  return `venmo-${token}@${domain}`;
}

export function parseVenmoForwardAddress(address: string, domain: string): string | null {
  const match = address.trim().toLowerCase().match(/^venmo-([a-z0-9]+)@(.+)$/);
  if (!match || match[2] !== domain.toLowerCase()) return null;
  const token = match[1];
  if (token.length !== VENMO_TOKEN_LENGTH || [...token].some((c) => !VENMO_TOKEN_ALPHABET.includes(c))) return null;
  return token;
}

export type VenmoPaymentEmail = {
  payerName: string;
  cents: number;
  note: string | null;
  transactionId: string | null;
  sentTo: string | null; // Handle without the @
  paidOn: string | null; // YYYY-MM-DD
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·" };

function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function htmlText(html: string) {
  return decodeEntities(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

// A link built with URLSearchParams turns spaces into "+", and Venmo keeps
// them. A note with pluses and no spaces had its spaces turned into them.
export function cleanVenmoNote(note: string) {
  const trimmed = note.replace(/\s+/g, " ").trim();
  return !trimmed.includes(" ") && trimmed.includes("+") ? trimmed.replace(/\+/g, " ").trim() : trimmed;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function isoDate(value: string) {
  const match = value.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})/);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toLowerCase());
  if (month < 0) return null;
  return `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

// "Becca Berg paid you $356.00" (and "… paid your $20.00 request"). Anything
// else Venmo sends (you paid, requests, login codes) is not a payment in.
export function parseVenmoPaymentEmail(email: { subject: string | null; html: string | null; text: string | null }): VenmoPaymentEmail | null {
  const subject = (email.subject ?? "").replace(/\s+/g, " ").trim();
  const head = subject.match(/^(.+?) paid (?:you|your) \$([\d,]+(?:\.\d{1,2})?)\b/);
  if (!head) return null;
  const payerName = head[1].trim();
  const [dollars, centsPart = ""] = head[2].replace(/,/g, "").split(".");
  const cents = Number(dollars) * 100 + Number(centsPart.padEnd(2, "0"));
  if (!payerName || !Number.isSafeInteger(cents) || cents <= 0) return null;

  const html = email.html ?? "";
  let note: string | null = null;
  const noteMatch = html.match(/<p\b[^>]*class=(["'])[^"']*\btransaction-note\b[^"']*\1[^>]*>([\s\S]*?)<\/p>/i);
  if (noteMatch) note = cleanVenmoNote(htmlText(noteMatch[2])) || null;

  const body = html ? htmlText(html) : (email.text ?? "").replace(/\s+/g, " ");
  const transactionId = body.match(/Transaction ID\s*:?\s*(\d{6,30})/i)?.[1] ?? null;
  const sentTo = body.match(/Sent to\s*:?\s*@([A-Za-z0-9_-]{1,40})/i)?.[1] ?? null;
  const dateText = body.match(/\bDate\s*:?\s*([A-Za-z]{3,9}\.? \d{1,2}, \d{4})/)?.[1];

  return { payerName, cents, note, transactionId, sentTo, paidOn: dateText ? isoDate(dateText) : null };
}

// What in a note says who it's from: invoice numbers (the pay link writes
// "Team · invoice #3, #5") and a ref code (the family app writes "Team · ref ABC23")
export function invoiceNumbersIn(note: string | null): number[] {
  if (!note) return [];
  const found = new Set<number>();
  for (const match of note.matchAll(/#\s*(\d{1,6})\b/g)) found.add(Number(match[1]));
  return [...found];
}

export function refCodesIn(note: string | null): string[] {
  if (!note) return [];
  return [...new Set([...note.matchAll(/\bref\W{0,3}([A-HJ-NP-Z2-9]{5})\b/gi)].map((m) => m[1].toUpperCase()))];
}

// Gmail's "(#123456789) Gmail Forwarding Confirmation - Receive Mail from
// jake@example.com", sent to a new forwarding address before Gmail forwards
// anything to it
export function parseGmailForwardingConfirmation(subject: string | null, text: string | null) {
  const s = subject ?? "";
  if (!/forwarding confirmation/i.test(s)) return null;
  const code = s.match(/\(#\s*(\d{6,12})\)/)?.[1] ?? (text ?? "").match(/confirmation code:?\s*(\d{6,12})/i)?.[1];
  if (!code) return null;
  const from = s.match(/receive mail from\s+(\S+@\S+)/i)?.[1] ?? null;
  return { code, from };
}
