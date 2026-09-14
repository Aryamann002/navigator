import { z } from "zod";
import { BriefEncodingError, buildBrief } from "@/lib/brief";
import { generatePrepSheet } from "@/lib/ai";
import type { LegalDocument } from "@/lib/contracts";
import { getDocument, getSession } from "@/lib/rag";
import { SAMPLE_DOCUMENT } from "@/lib/sample";
import { ApiError, handleError, readJson, requireConfigured } from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  document: z.object({
    id: z.union([z.literal("sample-service-agreement"), z.string().uuid()]),
    messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(6000) })).max(40).optional(),
    checked: z.array(z.string().max(128)).max(100).optional(),
  }),
});

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await readJson(request, 256_000));
    if (!parsed.success) throw new ApiError(400, "A valid document reference is required.");
    const id = parsed.data.document.id;
    let document: LegalDocument;
    if (id === "sample-service-agreement") {
      document = {
        ...SAMPLE_DOCUMENT,
        messages: (parsed.data.document.messages ?? []).filter((message) => message.role === "user"),
        checked: (parsed.data.document.checked ?? []).filter((id) => SAMPLE_DOCUMENT.analysis.findings.some((finding) => finding.id === id)),
      };
    } else {
      await requireConfigured();
      const session = await getSession();
      if (!session) throw new ApiError(401, "Your document session is unavailable. Upload the document again.");
      const stored = await getDocument<LegalDocument>(session, id);
      if (!stored) throw new ApiError(404, "This document is unavailable in your session.");
      document = stored;
      document = { ...document, checked: (parsed.data.document.checked ?? document.checked).filter((id) => document.analysis.findings.some((finding) => finding.id === id)) };
    }
    const prep = id === "sample-service-agreement" ? undefined : await generatePrepSheet(document);
    const bytes = await buildBrief(document, prep);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="lawyer-prep-sheet.pdf"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof BriefEncodingError) return handleError(new ApiError(422, error.message));
    return handleError(error);
  }
}
