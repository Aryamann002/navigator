import { z } from "zod";
import { answerDocument, routeIntent, validateAnswer } from "@/lib/ai";
import { type LegalDocument } from "@/lib/contracts";
import { getDocument, getSession, putDocument, retrieveDocument } from "@/lib/rag";
import { ApiError, handleError, json, readJson, requireConfigured } from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 180;
const requestSchema = z.object({ document: z.object({ id: z.string().uuid() }), message: z.string().trim().min(1).max(4000) });

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await readJson(request, 900_000));
    if (!parsed.success) throw new ApiError(400, "Choose an uploaded document and enter a question of 4,000 characters or fewer.");
    await requireConfigured();
    const session = await getSession();
    if (!session) throw new ApiError(401, "Your document session has expired. Please upload the document again.");
    const { message, document: reference } = parsed.data;
    const document = await getDocument<LegalDocument>(session, reference.id);
    if (document.messages.length >= 100) throw new ApiError(422, "This session has reached 50 questions. Download your prep sheet before starting a new document session.");
    const intent = await routeIntent(message);
    let answer: { content: string; citations: string[] };
    if (intent === "legal_advice" || intent === "out_of_scope") {
      answer = validateAnswer({ kind: intent, content: "Boundary response", evidence: [] }, document);
    } else {
      const { passages } = await retrieveDocument(session, reference.id, message);
      answer = await answerDocument(document, message, intent, passages);
    }
    await putDocument(session, { ...document, messages: [...document.messages, { role: "user", content: message }, { role: "assistant", ...answer }] });
    return json(answer);
  } catch (error) { return handleError(error); }
}
