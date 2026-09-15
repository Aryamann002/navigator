import { randomUUID } from "node:crypto";
import { analyzeDocument, buildFreeFallback } from "@/lib/ai";
import { type LegalDocument } from "@/lib/contracts";
import { browserSessionMode, getSession, groqMode, putDocument } from "@/lib/rag";
import { ApiError, checkRequest, handleError, json, parseUpload, readBody, requireConfigured } from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    checkRequest(request);
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data;")) throw new ApiError(415, "Upload a PDF or TXT file as multipart form data.");
    await requireConfigured();
    const bytes = await readBody(request);
    let form: FormData;
    try { form = await new Response(new Uint8Array(bytes), { headers: { "content-type": contentType } }).formData(); }
    catch { throw new ApiError(400, "The upload could not be read. Please choose the file again."); }
    const file = form.get("file");
    if (!(file instanceof File) || form.getAll("file").length !== 1) throw new ApiError(400, "Upload one document at a time.");
    const { pages, text, pageCount } = await parseUpload(file);
    const filename = file.name.replace(/[^\p{L}\p{N} ._()-]/gu, "_").slice(0, 200);
    let analysis;
    try { analysis = await analyzeDocument(pages, filename); }
    catch (error) {
      if (!groqMode()) throw error;
      const failure = error as { name?: unknown; code?: unknown; statusCode?: unknown };
      console.warn("Structured analysis fallback", {
        name: typeof failure.name === "string" ? failure.name : "UnknownError",
        code: typeof failure.code === "string" ? failure.code : undefined,
        status: typeof failure.statusCode === "number" ? failure.statusCode : undefined,
      });
      analysis = buildFreeFallback(pages, filename);
    }
    const document: LegalDocument = { id: randomUUID(), filename, uploadedAt: new Date().toISOString(), pageCount, text, analysis, messages: [], checked: [] };
    if (!browserSessionMode()) {
      const session = await getSession(true);
      if (!session) throw new ApiError(503, "A secure document session could not be created.");
      await putDocument(session, document);
    }
    return json({ document });
  } catch (error) { return handleError(error); }
}
