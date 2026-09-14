import { z } from "zod";
import { answerDocument, routeIntent, validateAnswer } from "@/lib/ai";
import { legalDocumentSchema, type LegalDocument } from "@/lib/contracts";
import { browserSessionMode, getDocument, getSession, putDocument, rankPassages, retrieveDocument } from "@/lib/rag";
import { ApiError, handleError, json, readJson, requireConfigured } from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 180;
const requestSchema = z.object({ document: z.union([z.object({ id: z.string().uuid() }), legalDocumentSchema]), message: z.string().trim().min(1).max(4000) });

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await readJson(request, 900_000));
    if (!parsed.success) throw new ApiError(400, "Choose an uploaded document and enter a question of 4,000 characters or fewer.");
    await requireConfigured();
    const { message, document: reference } = parsed.data;
    const sessionOnly = browserSessionMode();
    if (sessionOnly && !("analysis" in reference)) throw new ApiError(400, "The browser-session document is required.");
    const session = sessionOnly ? null : await getSession();
    if (!sessionOnly && !session) throw new ApiError(401, "Your document session has expired. Please upload the document again.");
    const document: LegalDocument = sessionOnly ? reference as LegalDocument : await getDocument<LegalDocument>(session!, reference.id);
    if (document.messages.length >= 100) throw new ApiError(422, "This session has reached 50 questions. Download your prep sheet before starting a new document session.");
    const intent = await routeIntent(message);
    let answer: { content: string; citations: string[] };
    if (intent === "legal_advice" || intent === "out_of_scope") {
      answer = validateAnswer({ kind: intent, content: "Boundary response", evidence: [] }, document);
    } else {
      const passages = sessionOnly ? rankPassages(document, message) : (await retrieveDocument(session!, reference.id, message)).passages;
      answer = await answerDocument(document, message, intent, passages);
    }
    if (session) await putDocument(session, { ...document, messages: [...document.messages, { role: "user", content: message }, { role: "assistant", ...answer }] });
    return json(answer);
  } catch (error) { return handleError(error); }
}
