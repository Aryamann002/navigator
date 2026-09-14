import { z } from "zod";
import { browserSessionMode, deleteDocument, getDocument, getSession, ragConfigured } from "@/lib/rag";
import { ApiError, checkRequest, handleError, json } from "@/lib/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

async function reference(request: Request, context: Context) {
  checkRequest(request, 0);
  const result = z.string().uuid().safeParse((await context.params).id);
  if (!result.success) throw new ApiError(400, "Invalid document reference.");
  if (browserSessionMode()) throw new ApiError(404, "Browser-session documents are not persisted.");
  if (!ragConfigured()) throw new ApiError(503, "Private storage is not connected.");
  const session = await getSession();
  if (!session) throw new ApiError(401, "Your document session has expired.");
  return { session, id: result.data };
}

export async function GET(request: Request, context: Context) {
  try {
    const { session, id } = await reference(request, context);
    return json({ document: await getDocument(session, id) });
  } catch (error) { return handleError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { session, id } = await reference(request, context);
    await deleteDocument(session, id);
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return handleError(error); }
}
