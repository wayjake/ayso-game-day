import fs from "node:fs/promises";
import path from "node:path";
import { PDFBool, PDFDocument, PDFName, StandardFonts, type PDFFont, type PDFTextField } from "pdf-lib";

// Blank copy of AYSO's official lineup card (form CS002-7). The first page has
// two identical cards side by side. Most fields have a widget on each card so
// one value fills both, but DATE and OPPOSING TEAM are separate per card.
const TEMPLATE_FILE = "game-card-template.pdf";
const MAX_ROWS = 18;
const DEFAULT_FONT_SIZE = 12;

export type GameCardData = {
  region: string | null;
  ageGroup: string | null;
  teamNumber: string | null;
  teamName: string;
  coachName: string | null;
  assistantCoachName: string | null;
  gameDate: string; // YYYY-MM-DD
  opponent: string | null;
  players: { name: string; jerseyNumber: number | null }[];
};

let templateBytes: Uint8Array | null = null;

async function loadTemplate() {
  if (templateBytes) return templateBytes;

  // `public/` in dev; the production image only ships `build/`, where Vite copies it
  const candidates = [
    path.join(process.cwd(), "public", TEMPLATE_FILE),
    path.join(process.cwd(), "build", "client", TEMPLATE_FILE),
  ];
  for (const candidate of candidates) {
    try {
      templateBytes = await fs.readFile(candidate);
      return templateBytes;
    } catch {
      // try the next location
    }
  }
  throw new Error(`Game card template not found (looked in ${candidates.join(", ")})`);
}

// "2026-10-05" -> "10/5/26", without going through Date (which would read it as UTC)
export function formatCardDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${parseInt(month)}/${parseInt(day)}/${year.slice(-2)}`;
}

// Jersey order, as the card requires; players without a number go last by name
export function sortForCard(players: GameCardData["players"]) {
  return [...players].sort((a, b) => {
    if (a.jerseyNumber == null && b.jerseyNumber == null) return a.name.localeCompare(b.name);
    if (a.jerseyNumber == null) return 1;
    if (b.jerseyNumber == null) return -1;
    return a.jerseyNumber - b.jerseyNumber || a.name.localeCompare(b.name);
  });
}

function fill(field: PDFTextField, value: string, font: PDFFont) {
  const widgets = field.acroField.getWidgets();
  const width = Math.min(...widgets.map((w) => w.getRectangle().width - 4));

  // Shrink long names to fit the box instead of letting them clip. The font
  // size lives on each widget (one per card), not on the field.
  let size = DEFAULT_FONT_SIZE;
  while (size > 6 && font.widthOfTextAtSize(value, size) > width) {
    size -= 0.5;
  }
  for (const widget of widgets) {
    widget.setDefaultAppearance(`0 g\n/Helvetica ${size} Tf`);
  }
  field.setText(value);
}

export async function buildGameCard(card: GameCardData) {
  const pdf = await PDFDocument.load(await loadTemplate());
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const form = pdf.getForm();
  const set = (name: string, value: string | null | undefined) => {
    if (value) fill(form.getTextField(name), value, font);
  };

  set("REGION", card.region);
  set("AGE GROUP", card.ageGroup);
  set("TEAM NUMBER", card.teamNumber);
  set("TEAM NAME", card.teamName);
  set("COACHS NAME", card.coachName);
  set("ASST COACHS NAME", card.assistantCoachName);

  const date = formatCardDate(card.gameDate);
  set("DATE", date);
  set("DATE_2", date);
  set("OPPOSING TEAM", card.opponent);
  set("OPPOSING TEAM_2", card.opponent);

  sortForCard(card.players)
    .slice(0, MAX_ROWS)
    .forEach((player, index) => {
      set(`Row${index + 1}`, player.jerseyNumber != null ? String(player.jerseyNumber) : null);
      set(`Player${index + 1}`, player.name);
    });

  form.updateFieldAppearances(font);
  // Draw the appearances generated above (with the shrunk font sizes) instead of
  // letting each viewer regenerate them at the template's 12pt and clip
  form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.False);
  return pdf.save();
}

export { MAX_ROWS as GAME_CARD_MAX_PLAYERS };
