import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import { DISCLAIMER, type LegalDocument } from "./contracts";
import type { PrepSheet } from "./ai";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const WIDTH = PAGE_WIDTH - MARGIN * 2;

export class BriefEncodingError extends Error {}

let fontCache: { regular: Buffer; bold: Buffer } | null = null;

async function getFontBuffers() {
  if (!fontCache) {
    const [regular, bold] = await Promise.all([
      readFile(path.join(process.cwd(), "public/fonts/NotoSans-Regular.ttf")),
      readFile(path.join(process.cwd(), "public/fonts/NotoSans-Bold.ttf")),
    ]);
    fontCache = { regular, bold };
  }
  return fontCache;
}

function wrap(text: string, font: PDFFont, size: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= WIDTH) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      for (const character of word) {
        if (font.widthOfTextAtSize(line + character, size) > WIDTH) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function buildBrief(document: LegalDocument, prep?: PrepSheet): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts = await getFontBuffers();
  const regular = await pdf.embedFont(fonts.regular, { subset: true });
  const bold = await pdf.embedFont(fonts.bold, { subset: true });
  const boldSupported = new Set(bold.getCharacterSet());
  const supported = new Set(regular.getCharacterSet().filter((code) => boldSupported.has(code)));
  pdf.setTitle(`Lawyer prep-sheet: ${document.analysis.title}`);
  pdf.setAuthor("Legal Document Navigator");
  pdf.setSubject(DISCLAIMER);
  pdf.setCreator("Legal Document Navigator");
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function pageHeader() {
    page.drawText("LEGAL DOCUMENT NAVIGATOR", { x: MARGIN, y, size: 9, font: bold });
    y -= 16;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.6, color: rgb(0.75, 0.75, 0.75) });
    y -= 28;
  }
  function ensureSpace(height: number) {
    if (y - height < 88) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      pageHeader();
    }
  }
  function paragraph(text: string, size = 10, strong = false, gap = 9) {
    if ([...text].some((character) => !/\s/.test(character) && !supported.has(character.codePointAt(0)!))) {
      throw new BriefEncodingError("This brief includes characters the PDF font cannot preserve. Export supports Latin, Greek and Cyrillic text; use the original document for other scripts.");
    }
    const font = strong ? bold : regular;
    for (const line of wrap(text, font, size)) {
      ensureSpace(size * 1.45);
      page.drawText(line, { x: MARGIN, y, font, size, color: rgb(0.09, 0.09, 0.09) });
      y -= size * 1.45;
    }
    y -= gap;
  }
  function section(title: string) {
    ensureSpace(58);
    y -= 9;
    paragraph(title, 13, true, 10);
  }
  function references(ids: string[]) {
    return ids.map((id) => {
      const clause = document.analysis.clauses.find((item) => item.id === id);
      return clause ? `${clause.heading} [${clause.id}], p. ${clause.page}` : "Source reference unavailable";
    }).join("; ");
  }

  pageHeader();
  paragraph("Lawyer prep-sheet", 23, true, 12);
  paragraph(DISCLAIMER, 10, true);
  if (document.sample) paragraph("ILLUSTRATIVE SAMPLE - prepared from a built-in fictional agreement. This is not an analysis of your document.", 10, true);
  paragraph("Prepared for a conversation with a qualified legal professional. Verify every point against the original document; automated analysis can miss context or make mistakes.");

  section("01 / Document details");
  paragraph(document.analysis.title, 12, true);
  paragraph(`File: ${document.filename}\nType: ${document.analysis.documentType}\nPages: ${document.pageCount}\nPrepared: ${new Date().toISOString().slice(0, 10)} (UTC)\nDocument reference: ${document.id}`);

  section("02 / Plain-English overview");
  paragraph(prep?.summary || document.analysis.summary);

  section("03 / Risks, obligations and critical dates");
  if (!document.analysis.findings.length) paragraph("No findings were identified. This does not mean the document is free from risks or obligations.");
  for (const finding of document.analysis.findings) {
    ensureSpace(65);
    paragraph(`${finding.category.toUpperCase()} / ${finding.title}`, 11, true, 5);
    paragraph(`Attention: ${finding.severity}${finding.date ? ` | Date stated: ${finding.date}` : ""}`, 9, false, 5);
    if (document.checked.includes(finding.id)) paragraph("Marked as reviewed by the user; this does not confirm any obligation has been fulfilled.", 9, false, 5);
    paragraph(finding.description, 10, false, 5);
    paragraph(`Source: ${references([finding.clauseId])}`, 9, true, 5);
    const clause = document.analysis.clauses.find((item) => item.id === finding.clauseId);
    const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
    if (clause && finding.quote.trim() && normalize(clause.original).includes(normalize(finding.quote))) {
      paragraph(`Document excerpt: "${finding.quote}"`, 9);
    } else {
      paragraph("No matching source excerpt was verified. Check this point in the original document.", 9);
    }
  }

  if (prep?.issues.length) {
    section("04 / Points to discuss");
    for (const issue of prep.issues) {
      ensureSpace(55);
      paragraph(issue.title, 11, true, 5);
      paragraph(issue.detail, 10, false, 5);
      paragraph(`Source: ${references(issue.clauseIds) || "No specific clause cited; confirm with your lawyer."}`, 9);
    }
  }

  section("Your questions and concerns");
  const concerns = document.messages.filter((message) => message.role === "user");
  if (!concerns.length) paragraph("No questions were recorded in this document's conversation.");
  else paragraph("These are user-provided concerns, not verified document terms.", 9);
  concerns.forEach((message, index) => paragraph(`${index + 1}. ${message.content}`));
  if (prep?.conversationNotes.length) {
    paragraph("Conversation notes (AI-generated summary)", 11, true);
    prep.conversationNotes.forEach((note) => paragraph(`- ${note}`));
  }

  section("Questions for your legal professional");
  const questions = prep?.questions.length ? prep.questions : document.analysis.questions;
  if (!questions.length) paragraph("Which clauses should we review together, and what additional information do you need from me?");
  questions.forEach((question, index) => paragraph(`${index + 1}. ${question}`));

  section("Information to bring or confirm");
  paragraph("Bring the complete original agreement, any amendments, relevant correspondence, and your desired outcome.");
  prep?.missingInformation.forEach((item) => paragraph(`- ${item}`));
  paragraph("Confirm dates, applicable jurisdiction, missing terms, and any action with your legal professional. This brief does not determine enforceability or recommend whether to sign.", 9);

  const pages = pdf.getPages();
  for (let index = 0; index < pages.length; index++) {
    const current = pages[index];
    current.drawLine({ start: { x: MARGIN, y: 73 }, end: { x: PAGE_WIDTH - MARGIN, y: 73 }, thickness: 0.6, color: rgb(0.75, 0.75, 0.75) });
    wrap(DISCLAIMER, bold, 8).forEach((line, lineIndex) => current.drawText(line, { x: MARGIN, y: 58 - lineIndex * 11, size: 8, font: bold }));
    const number = `${index + 1} / ${pages.length}`;
    current.drawText(number, { x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(number, 8), y: 24, size: 8, font: regular });
    current.drawText(document.sample ? "ILLUSTRATIVE SAMPLE" : "PRIVATE / GENERATED BRIEF", { x: MARGIN, y: 24, size: 8, font: regular });
  }
  return pdf.save();
}
