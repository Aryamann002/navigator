import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { DISCLAIMER, legalDocumentSchema, type LegalDocument } from "../src/lib/contracts";
import { getServiceStatus, LEGAL_SYSTEM, validateAnalysis, validateAnswer } from "../src/lib/ai";
import { rankPassages } from "../src/lib/rag";
import { ApiError, checkRequest, handleError, MAX_UPLOAD_BYTES, parseUpload, readBody, readJson } from "../src/lib/server";
import { POST as analyze } from "../src/app/api/analyze/route";

const source = "The tenant must pay USD 2,000 on the first day of each month.";
const document: LegalDocument = {
  id: "86420271-45d3-4f51-85fd-c1e571e74936", filename: "lease.txt", uploadedAt: "2026-09-14T00:00:00.000Z", pageCount: 1, text: source, messages: [], checked: [],
  analysis: {
    title: "Lease", documentType: "Residential lease", summary: "Monthly rent is specified.",
    clauses: [{ id: "c1", heading: "Rent", original: source, plain: "Rent of USD 2,000 is due on the first of each month.", page: 1 }],
    findings: [{ id: "f1", category: "obligation", title: "Monthly rent", description: "The lease specifies monthly rent.", severity: "medium", clauseId: "c1", quote: "USD 2,000", date: null }],
    questions: ["What happens if the payment date falls on a holiday?"],
  },
};

test("grounding rejects invented clauses, incorrect pages, missing text and unsupported findings", () => {
  assert.ok(LEGAL_SYSTEM.startsWith(DISCLAIMER));
  assert.deepEqual(validateAnalysis(document.analysis, [{ page: 1, text: source }]), document.analysis);
  for (const mutate of [
    (value: LegalDocument) => { value.analysis.clauses[0].original = "The tenant pays nothing."; },
    (value: LegalDocument) => { value.analysis.clauses[0].page = 2; },
    (value: LegalDocument) => { value.analysis.findings[0].quote = "USD 3,000"; },
    (value: LegalDocument) => { value.analysis.findings[0].clauseId = "invented"; },
  ]) {
    const changed = structuredClone(document);
    mutate(changed);
    assert.throws(() => validateAnalysis(changed.analysis, [{ page: 1, text: source }]), /ungrounded/);
  }
  assert.throws(() => validateAnalysis(document.analysis, [{ page: 1, text: `${source} This contract renews automatically.` }]), /complete source/);
});

test("answers require exact document evidence and legal decisions receive a fixed boundary response", () => {
  const answer = { kind: "document_answer", content: "The stated monthly rent is USD 2,000.", evidence: [{ clauseId: "c1", quote: "USD 2,000" }] };
  assert.deepEqual(validateAnswer(answer, document).citations, ["c1"]);
  assert.throws(() => validateAnswer({ ...answer, evidence: [] }, document), /no source evidence/);
  assert.throws(() => validateAnswer({ ...answer, evidence: [{ clauseId: "c1", quote: "USD 500" }] }, document), /ungrounded/);
  assert.throws(() => validateAnswer({ ...answer, evidence: [{ clauseId: "unknown", quote: "USD 2,000" }] }, document), /ungrounded/);
  const refusal = validateAnswer({ kind: "legal_advice", content: "You should sign this.", evidence: [] }, document);
  assert.ok(refusal.content.includes(DISCLAIMER));
  assert.ok(!refusal.content.includes("You should sign"));
});

test("browser-session mode is ready with Groq and validates stateless document input", async () => {
  const savedMode = process.env.BROWSER_SESSION_MODE;
  const savedKey = process.env.GROQ_API_KEY;
  process.env.BROWSER_SESSION_MODE = "true";
  process.env.GROQ_API_KEY = "test-key";
  try {
    assert.deepEqual(await getServiceStatus(), { ready: true, missing: [], storage: "browser-session", model: process.env.GROQ_MODEL || "openai/gpt-oss-20b" });
    assert.equal(rankPassages(document, "monthly rent")[0].id, "c1");
    assert.equal(legalDocumentSchema.safeParse({ ...document, filename: "x".repeat(201) }).success, false);
  } finally {
    if (savedMode === undefined) delete process.env.BROWSER_SESSION_MODE;
    else process.env.BROWSER_SESSION_MODE = savedMode;
    if (savedKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = savedKey;
  }
});

test("requests enforce origin, declared size, actual stream size and valid JSON", async () => {
  assert.doesNotThrow(() => checkRequest(new Request("http://0.0.0.0:3000/api/brief", { headers: { host: "localhost:3000", origin: "http://localhost:3000" } })));
  assert.doesNotThrow(() => checkRequest(new Request("http://internal:3000/api/brief", { headers: { host: "navigator.example", origin: "https://navigator.example" } })));
  assert.throws(() => checkRequest(new Request("http://internal:3000/api/brief", { headers: { host: "navigator.example", origin: "https://attacker.example" } })), (error) => error instanceof ApiError && error.status === 403);
  assert.throws(() => checkRequest(new Request("https://navigator.test/api/chat", { headers: { origin: "null" } })), (error) => error instanceof ApiError && error.status === 403);
  assert.throws(() => checkRequest(new Request("https://navigator.test/api/chat", { headers: { origin: "https://navigator.test", "sec-fetch-site": "cross-site" } })), (error) => error instanceof ApiError && error.status === 403);
  assert.throws(() => checkRequest(new Request("https://navigator.test/api/chat", { headers: { origin: "https://attacker.test" } })), (error) => error instanceof ApiError && error.status === 403);
  assert.throws(() => checkRequest(new Request("https://navigator.test/api/chat", { headers: { "content-length": "99999999" } })), (error) => error instanceof ApiError && error.status === 413);
  await assert.rejects(readBody(new Request("https://navigator.test/api/chat", { method: "POST", body: "123456" }), 5), (error) => error instanceof ApiError && error.status === 413);
  await assert.rejects(readJson(new Request("https://navigator.test/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: "{" })), (error) => error instanceof ApiError && error.status === 400);
  const response = handleError(new Error("secret-provider-key must never appear"));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.ok(!(await response.text()).includes("secret-provider-key"));
});

test("upload parsing preserves PDF page numbers and rejects disguised files and oversize text", async () => {
  const parsedText = await parseUpload(new File([source], "lease.txt", { type: "text/plain" }));
  assert.equal(parsedText.text, source);
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText(source, { x: 30, y: 700, size: 10 });
  pdf.addPage().drawText("The landlord must provide a written receipt for each payment.", { x: 30, y: 700, size: 10 });
  const parsedPdf = await parseUpload(new File([new Uint8Array(await pdf.save())], "lease.pdf", { type: "application/pdf" }));
  assert.deepEqual(parsedPdf.pages.map((page) => page.page), [1, 2]);
  assert.ok(parsedPdf.text.includes(source));
  await assert.rejects(parseUpload(new File([source], "fake.pdf", { type: "application/pdf" })), (error) => error instanceof ApiError && error.status === 422);
  await assert.rejects(parseUpload(new File([new Uint8Array([0xff, 0xfe, 0x41])], "bad.txt", { type: "text/plain" })), (error) => error instanceof ApiError && error.status === 422);
  await assert.rejects(parseUpload(new File(["a".repeat(160_001)], "large.txt")), (error) => error instanceof ApiError && error.status === 413);
  await assert.rejects(parseUpload(new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "large.pdf")), (error) => error instanceof ApiError && error.status === 413);
});

test("unconfigured analysis returns an honest 503 without generating a document", async () => {
  const savedKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  try {
    const form = new FormData();
    form.set("file", new File([source], "lease.txt", { type: "text/plain" }));
    const response = await analyze(new Request("http://localhost:3000/api/analyze", { method: "POST", body: form }));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.document, undefined);
    assert.match(body.error, /awaiting/);
  } finally {
    if (savedKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = savedKey;
  }
});

test("rankPassages handles phrase matching, empty queries, and missing clause fields", () => {
  const customDoc: LegalDocument = {
    ...document,
    analysis: {
      ...document.analysis,
      clauses: [
        { id: "c1", heading: "Rent Details", original: "Tenant pays USD 2000 per month.", plain: "Monthly rent.", page: 1 },
        { id: "c2", heading: "Termination Clause", original: "Either party may terminate upon 30 days notice.", plain: "30 day cancellation.", page: 1 },
      ],
    },
  };
  const ranked = rankPassages(customDoc, "Tenant pays USD 2000 per month.");
  assert.equal(ranked[0].id, "c1");
  assert.ok(ranked[0].score > ranked[1].score);

  const emptyRank = rankPassages(customDoc, "  ");
  assert.equal(emptyRank.length, 2);
});
