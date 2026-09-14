import { getServiceStatus, normalizeSource, type SourcePage } from "./ai";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_TEXT_BYTES = 160_000;

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

export function handleError(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message }, error.status);
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  if (status === 404) return json({ error: "This document was not found in your session. Please upload it again." }, 404);
  if (status === 409) return json({ error: "The conversation changed while this answer was being prepared. Please try your question again." }, 409);
  if (status === 413) return json({ error: "This document is too large for the document service." }, 413);
  if (status === 503) return json({ error: "Secure document storage is unavailable. Please try again later." }, 503);
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return json({ error: "The document service timed out. Please try again." }, 504);
  }
  return json({ error: "The document service could not complete this request. Please try again." }, 502);
}

export function checkRequest(request: Request, maxBytes = MAX_UPLOAD_BYTES + 65_536) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host")?.toLowerCase() || new URL(request.url).host;
  let sameHost = !origin;
  if (origin) {
    try {
      const source = new URL(origin);
      sameHost = ["http:", "https:"].includes(source.protocol) && source.host === host;
    } catch { sameHost = false; }
  }
  if (!sameHost || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError(403, "Requests must come from this application.");
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length < 0 || length > maxBytes) throw new ApiError(413, "This request is too large.");
}

export async function readBody(request: Request, maxBytes = MAX_UPLOAD_BYTES + 65_536) {
  checkRequest(request, maxBytes);
  if (!request.body) throw new ApiError(400, "A request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "This request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export async function readJson(request: Request, maxBytes = 256_000): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "Send this request as JSON.");
  }
  const body = await readBody(request, maxBytes);
  try { return JSON.parse(body.toString("utf8")); }
  catch { throw new ApiError(400, "The request contains invalid JSON."); }
}

export async function requireConfigured() {
  const status = await getServiceStatus();
  if (!status.ready) throw new ApiError(503, "Document analysis is awaiting its secure AI and storage connections. Please try again after setup is complete.");
}

export async function parseUpload(file: File): Promise<{ pages: SourcePage[]; text: string; pageCount: number }> {
  if (!file.size || file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "Choose a non-empty PDF or TXT file up to 4 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const isPdf = file.name.toLowerCase().endsWith(".pdf");
  const isText = file.name.toLowerCase().endsWith(".txt");
  const expectedType = isPdf ? "application/pdf" : "text/plain";
  if ((!isPdf && !isText) || (file.type && ![expectedType, "application/octet-stream"].includes(file.type))) {
    throw new ApiError(415, "Only PDF and UTF-8 TXT documents are supported.");
  }
  let pages: SourcePage[];
  if (isPdf) {
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new ApiError(422, "This file does not contain a valid PDF.");
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 });
    try {
      const info = await parser.getInfo();
      if (info.total > 100) throw new ApiError(413, "Choose a document with 100 pages or fewer.");
      const result = await parser.getText();
      pages = result.pages.map((page) => ({ page: page.num, text: normalizeSource(page.text) }));
      if (pages.some((page) => page.text.length < 20)) {
        throw new ApiError(422, "Some PDF pages have no readable text. Upload a searchable PDF or a TXT transcription of the complete document.");
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(422, "This PDF could not be read. Use an unlocked, searchable PDF or UTF-8 TXT file.");
    } finally { await parser.destroy(); }
  } else {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new ApiError(422, "Save this text document using UTF-8 encoding before uploading."); }
    if ([...text].some((character) => character.charCodeAt(0) < 32 && !"\t\n\r".includes(character))) throw new ApiError(422, "This file contains binary data instead of readable text.");
    pages = [{ page: 1, text: normalizeSource(text) }];
  }
  const text = pages.map((page) => page.text).join("\n\n");
  if (text.length < 40) throw new ApiError(422, "This document has too little readable text. Upload the complete contract.");
  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) throw new ApiError(413, "The extracted text exceeds 160 KB. Please upload a shorter document.");
  return { pages, text, pageCount: pages.length };
}
