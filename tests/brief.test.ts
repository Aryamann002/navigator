import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { PDFParse } from "pdf-parse";
import { BriefEncodingError, buildBrief } from "../src/lib/brief";
import { DISCLAIMER } from "../src/lib/contracts";
import { SAMPLE_DOCUMENT } from "../src/lib/sample";
import { POST } from "../src/app/api/brief/route";

test("brief preserves sourced findings, concerns, Unicode, and disclaimer on every page", async () => {
  const document = structuredClone(SAMPLE_DOCUMENT);
  document.messages = [{ role: "user", content: "Can Ren\u00e9 discuss the \u20ac6,000 fee and (ownership) \\ transfer?" }];
  document.analysis.findings.push({ ...document.analysis.findings[0], id: "invalid-source", quote: "FABRICATED SOURCE EXCERPT" });
  const bytes = await buildBrief(document);
  const metadata = await PDFDocument.load(bytes);
  assert.equal(metadata.getSubject(), DISCLAIMER);
  assert.ok(metadata.getPageCount() > 1);
  const parser = new PDFParse({ data: bytes.slice() });
  try {
    const result = await parser.getText();
    const text = result.text.replace(/\s+/g, " ");
    assert.ok(text.includes(DISCLAIMER));
    assert.ok(text.includes("Ren\u00e9"));
    assert.ok(text.includes("\u20ac6,000"));
    assert.ok(text.includes("(ownership) \\ transfer"));
    assert.ok(text.includes("Liability and indemnity [5], p. 3"));
    assert.ok(text.includes("2026-11-30"));
    assert.ok(text.includes("Could my liability be limited"));
    assert.ok(!text.includes("FABRICATED SOURCE EXCERPT"));
    assert.ok(text.includes("No matching source excerpt was verified"));
    for (const [index, page] of result.pages.entries()) {
      const pageText = page.text.replace(/\s+/g, " ");
      assert.ok(pageText.includes(DISCLAIMER), `Missing disclaimer on page ${index + 1}`);
      assert.ok(pageText.includes(`${index + 1} / ${result.total}`));
      assert.ok(pageText.includes("ILLUSTRATIVE SAMPLE"));
    }
    if (process.env.PDF_QA_OUTPUT) {
      const directory = path.resolve(process.env.PDF_QA_OUTPUT);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "lawyer-prep-sheet.pdf"), bytes);
      const images = await parser.getScreenshot({ scale: 1.5 });
      for (const [index, image] of images.pages.entries()) await writeFile(path.join(directory, `page-${index + 1}.png`), image.data);
    }
  } finally {
    await parser.destroy();
  }

  document.analysis.summary = "Long agreement summary. ".repeat(300) + "x".repeat(600);
  const longParser = new PDFParse({ data: await buildBrief(document) });
  try {
    const result = await longParser.getText();
    assert.ok(result.total > metadata.getPageCount());
    assert.ok(result.text.includes("Information to bring or confirm"));
    assert.equal((result.text.replace(/\s+/g, " ").match(/Long agreement summary\./g) || []).length, 300);
    assert.ok(result.pages.every((page) => page.text.replace(/\s+/g, " ").includes(DISCLAIMER)));
  } finally {
    await longParser.destroy();
  }

  document.messages = [{ role: "user", content: "Unrenderable character: \u{1F4DC}" }];
  await assert.rejects(() => buildBrief(document), BriefEncodingError);
});

test("brief endpoint resolves its own sample and rejects invalid references and cross-site requests", async () => {
  const body = { document: { ...SAMPLE_DOCUMENT, analysis: { summary: "CLIENT FORGED ANALYSIS" }, messages: [{ role: "user", content: "MY SAMPLE PAYMENT QUESTION" }, { role: "assistant", content: "CLIENT FORGED ANSWER" }], checked: ["r1", "fake-finding"] } };
  const request = (value: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/brief", {
    method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(value),
  });
  const response = await POST(request(body));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const parser = new PDFParse({ data: new Uint8Array(await response.arrayBuffer()) });
  try {
    const result = await parser.getText();
    assert.ok(result.text.includes("Service agreement"));
    assert.ok(!result.text.includes("CLIENT FORGED ANALYSIS"));
    assert.ok(!result.text.includes("CLIENT FORGED ANSWER"));
    assert.ok(result.text.includes("MY SAMPLE PAYMENT QUESTION"));
    assert.ok(result.text.includes("Marked as reviewed by the user"));
  } finally {
    await parser.destroy();
  }
  assert.equal((await POST(request({ document: { id: "../another-session" } }))).status, 400);
  assert.equal((await POST(request(body, "https://untrusted.example"))).status, 403);
});
