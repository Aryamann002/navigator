import { getServiceStatus } from "@/lib/ai";
import { handleError, json } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return json(await getServiceStatus()); }
  catch (error) { return handleError(error); }
}
