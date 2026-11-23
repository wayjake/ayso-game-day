// Pure helpers for reading replies that come back by email. No I/O here, so
// they can be checked against sample emails directly.

export type HeaderMap = Record<string, string | string[]> | null | undefined;

// Header lookup is case-insensitive; repeated headers come back joined
export function getHeader(headers: HeaderMap, name: string): string | null {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return Array.isArray(value) ? value.join(" ") : String(value);
  }
  return null;
}

// Every <message-id> mentioned in In-Reply-To and References, newest first
export function referencedMessageIds(headers: HeaderMap): string[] {
  const ids = (name: string) => (getHeader(headers, name)?.match(/<[^<>\s]+>/g) ?? []).map(normalizeMessageId);
  // In-Reply-To first, then References from newest (last) to oldest
  return [...new Set([...ids("in-reply-to"), ...ids("references").reverse()])];
}

export function normalizeMessageId(id: string) {
  const trimmed = id.trim();
  return (trimmed.startsWith("<") ? trimmed : `<${trimmed}>`).toLowerCase();
}

// "Maria Garcia <maria@example.com>" -> { name, address }
export function parseAddress(value: string | null | undefined): { name: string | null; address: string } | null {
  if (!value) return null;
  const angle = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (angle) {
    const name = angle[1].trim();
    return { name: name || null, address: angle[2].trim().toLowerCase() };
  }
  const bare = value.trim().toLowerCase();
  return bare.includes("@") ? { name: null, address: bare } : null;
}

// Out-of-office and other machine replies shouldn't count as a family replying
export function isAutoReply(headers: HeaderMap, subject: string | null | undefined) {
  const autoSubmitted = getHeader(headers, "auto-submitted");
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") return true;
  const precedence = getHeader(headers, "precedence")?.toLowerCase();
  if (precedence && ["auto_reply", "bulk", "junk", "list"].includes(precedence)) return true;
  if (getHeader(headers, "x-autoreply") || getHeader(headers, "x-autorespond") || getHeader(headers, "x-auto-response-suppress")?.match(/all|oof|autoreply/i)) {
    return true;
  }
  return /^(auto(matic)?[ -]?reply|out of (the )?office|autoreply|away from)/i.test(subject?.trim() ?? "");
}

// SPF/DKIM/DMARC as reported by Resend. Only an explicit pass on DMARC, or on
// DKIM when DMARC wasn't evaluated, counts; anything else is unproven.
export function authenticationPassed(auth: { spf?: string; dkim?: string; dmarc?: string } | null | undefined) {
  if (!auth) return false;
  const pass = (v?: string) => typeof v === "string" && v.toLowerCase() === "pass";
  if (auth.dmarc && auth.dmarc.toLowerCase() !== "none") return pass(auth.dmarc);
  return pass(auth.dkim) || pass(auth.spf);
}

// Rough HTML to text, for emails that arrive with no text part. Never rendered
// as HTML anywhere.
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Lines that end the new part of a reply on their own: phone signatures and
// non-English "wrote:" lines. Gmail/Apple/Outlook quote headers are checked
// in stripQuotedReply, since some need the following line too.
const CUT_LINES: RegExp[] = [
  /^Sent from my (iPhone|iPad|Android|Samsung|Galaxy|Pixel|mobile)/i,
  /^Sent from (Outlook|Yahoo Mail|Mail for Windows)/i,
  /^Get Outlook for (iOS|Android)/i,
  /^Le\s.+\sa écrit\s?:\s*$/i,
  /^El\s.+\sescribió:\s*$/i,
  /^Am\s.+\sschrieb\s.+:\s*$/i,
];

// The new part of a reply, with the quoted email and phone signatures cut off.
// Returns the full text when nothing obvious can be trimmed.
export function stripQuotedReply(text: string): { body: string; trimmed: boolean } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let cut = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const next = (lines[i + 1] ?? "").trim();

    if (/^On\s.+\swrote:\s*$/i.test(line)) { cut = i; break; }
    // Two-line "On Tue, Nov 4, 2026 at 9:14 AM Jake Berg <jake@…>\nwrote:"
    if (/^On\s/i.test(line) && /wrote:\s*$/i.test(next)) { cut = i; break; }
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line)) { cut = i; break; }
    if (/^_{10,}\s*$/.test(line) && /^From:\s/i.test(next)) { cut = i; break; }
    if (/^From:\s.+/i.test(line) && /^(Sent|Date|To):\s/i.test(next)) { cut = i; break; }
    if (CUT_LINES.some((re) => re.test(line))) { cut = i; break; }
    // A run of ">" quoted lines that continues to the end
    if (line.startsWith(">") && lines.slice(i).every((l) => l.trim() === "" || l.trim().startsWith(">"))) { cut = i; break; }
  }

  const kept = (cut === -1 ? lines : lines.slice(0, cut)).join("\n");
  // Strip a trailing "-- " signature block
  const sig = kept.search(/\n-- ?\n/);
  const body = (sig === -1 ? kept : kept.slice(0, sig)).trim();

  // Never return an empty reply: fall back to the whole thing
  if (!body) return { body: text.trim(), trimmed: false };
  return { body, trimmed: body.length < text.trim().length };
}
