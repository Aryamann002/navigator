import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { PDFParse } from "pdf-parse";
import { SAMPLE_DOCUMENT } from "../src/lib/sample";

async function main() {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Northstar Studio - Illustrative Services Agreement");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let index = 1; index <= 4; index++) {
    const page = pdf.addPage([595, 842]);
    const ink = rgb(0.13, 0.13, 0.13);
    const gray = rgb(0.5, 0.5, 0.5);
    page.drawText("NORTHSTAR", {
      x: 50,
      y: 778,
      size: 11,
      font: bold,
      color: ink,
    });
    page.drawText("STUDIO", {
      x: 50,
      y: 761,
      size: 9,
      font: regular,
      color: gray,
    });
    page.drawText("01 SEPTEMBER 2026", {
      x: 402,
      y: 778,
      size: 8,
      font: regular,
      color: gray,
    });
    page.drawLine({
      start: { x: 50, y: 735 },
      end: { x: 545, y: 735 },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });
    page.drawText(index === 1 ? "SERVICES" : "SERVICES AGREEMENT", {
      x: 50,
      y: 683,
      size: index === 1 ? 31 : 21,
      font: bold,
      color: ink,
    });
    if (index === 1)
      page.drawText("AGREEMENT", {
        x: 50,
        y: 644,
        size: 31,
        font: bold,
        color: ink,
      });
    page.drawText("NORTHSTAR STUDIO LTD. & ALEX MORGAN", {
      x: 50,
      y: index === 1 ? 614 : 655,
      size: 8,
      font: regular,
      color: gray,
    });
    let y = index === 1 ? 562 : 603;
    for (const clause of SAMPLE_DOCUMENT.analysis.clauses.filter(
      (c) => c.page === index,
    )) {
      page.drawText(`${clause.id}. ${clause.heading.toUpperCase()}`, {
        x: 50,
        y,
        size: 10,
        font: bold,
        color: ink,
      });
      y -= 26;
      let line = "";
      for (const word of clause.original.split(" ")) {
        if (regular.widthOfTextAtSize(`${line} ${word}`.trim(), 11) > 493) {
          page.drawText(line, {
            x: 50,
            y,
            size: 11,
            font: regular,
            color: rgb(0.35, 0.35, 0.35),
          });
          y -= 19;
          line = word;
        } else line = `${line} ${word}`.trim();
      }
      if (line) {
        page.drawText(line, {
          x: 50,
          y,
          size: 11,
          font: regular,
          color: rgb(0.35, 0.35, 0.35),
        });
        y -= 19;
      }
      y -= 32;
    }
    page.drawLine({
      start: { x: 50, y: 67 },
      end: { x: 545, y: 67 },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });
    page.drawText("ILLUSTRATIVE SAMPLE / NOT FOR SIGNATURE", {
      x: 50,
      y: 47,
      size: 8,
      font: regular,
      color: gray,
    });
    page.drawText(`${index} / 4`, {
      x: 525,
      y: 47,
      size: 8,
      font: regular,
      color: gray,
    });
  }
  await mkdir("public", { recursive: true });
  const bytes = await pdf.save();
  await writeFile("public/sample-contract.pdf", bytes);
  const parser = new PDFParse({ data: bytes });
  try {
    const preview = await parser.getScreenshot({ partial: [1], scale: 1.5 });
    await writeFile("public/sample-contract.png", preview.pages[0].data);
  } finally {
    await parser.destroy();
  }
}
void main();
