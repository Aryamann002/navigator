import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { GoogleAuth } from "google-auth-library";
import type { LegalDocument } from "./contracts";

const SESSION_SECONDS = 86_400;
let auth: GoogleAuth | undefined;
const localDocuments = new Map<string, Map<string, LegalDocument>>();
const localSecret = randomBytes(32).toString("hex");

export function freeMode() { return process.env.LOCAL_FREE_MODE === "true" && process.env.NODE_ENV !== "production"; }
export function browserSessionMode() { return process.env.BROWSER_SESSION_MODE === "true"; }
export function groqMode() { return freeMode() || browserSessionMode(); }

export function missingRagConfig(): string[] {
  if (groqMode()) return [];
  const missing: string[] = [];
  if (!process.env.CLOUD_RUN_RAG_URL) missing.push("CLOUD_RUN_RAG_URL");
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) missing.push("SESSION_SECRET");
  return missing;
}

export function ragConfigured(): boolean { return missingRagConfig().length === 0; }

export async function getSession(create = false): Promise<string | null> {
  const secret = process.env.SESSION_SECRET || (freeMode() ? localSecret : "");
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  const jar = await cookies();
  const name = process.env.NODE_ENV === "production" ? "__Host-ldn-session" : "ldn-session";
  const token = jar.get(name)?.value;
  const sign = (value: string) => createHmac("sha256", secret).update(value).digest("base64url");
  if (token) {
    const [session, issued, signature, extra] = token.split(".");
    if (!extra && /^[a-f0-9]{64}$/.test(session ?? "") && /^\d{13}$/.test(issued ?? "") && signature) {
      const expected = Buffer.from(sign(`${session}.${issued}`));
      const actual = Buffer.from(signature);
      const age = Date.now() - Number(issued);
      if (actual.length === expected.length && timingSafeEqual(actual, expected) && age >= 0 && age < SESSION_SECONDS * 1000) return session;
    }
  }
  if (!create) return null;
  const session = randomBytes(32).toString("hex");
  const value = `${session}.${Date.now()}`;
  jar.set(name, `${value}.${sign(value)}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: SESSION_SECONDS });
  if (freeMode()) localDocuments.set(session, localDocuments.get(session) || new Map());
  return session;
}

async function request<T>(session: string, id: string, method: string, body?: unknown, suffix = ""): Promise<T> {
  if (freeMode()) {
    const documents = localDocuments.get(session) || new Map<string, LegalDocument>();
    localDocuments.set(session, documents);
    if (method === "PUT") { const document = (body as { document: LegalDocument }).document; documents.set(id, document); return { documentId: id } as T; }
    if (method === "GET") { const document = documents.get(id); if (!document) throw Object.assign(new Error("Document not found or session expired."), { status: 404 }); return document as T; }
    if (method === "POST" && suffix === "/retrieve") {
      const document = documents.get(id); if (!document) throw Object.assign(new Error("Document not found or session expired."), { status: 404 });
      return { passages: rankPassages(document, String((body as { query?: string }).query || "")) } as T;
    }
    if (method === "DELETE") { documents.delete(id); return undefined as T; }
  }
  if (!ragConfigured()) throw Object.assign(new Error("Encrypted document storage is not configured."), { status: 503 });
  if (!/^[a-f0-9]{64}$/.test(session) || !/^[a-f0-9-]{36}$/i.test(id)) throw Object.assign(new Error("Invalid document session."), { status: 400 });
  const endpoint = new URL(process.env.CLOUD_RUN_RAG_URL!);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) throw new Error("CLOUD_RUN_RAG_URL must be an HTTPS service origin.");
  if (!auth) {
    const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) : undefined;
    auth = new GoogleAuth(credentials ? { credentials } : {});
  }
  const client = await auth.getIdTokenClient(endpoint.origin);
  try {
    const result = await client.request<T>({
      url: `${endpoint.origin}/documents/${encodeURIComponent(id)}${suffix}`,
      method: method as "GET" | "PUT" | "POST" | "DELETE",
      headers: { "x-legal-session": session, "Content-Type": "application/json", "Cache-Control": "no-store" },
      data: body, timeout: 180_000,
    });
    return result.data;
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 404) throw Object.assign(new Error("Document not found or session expired. Upload it again."), { status: 404 });
    if (status === 413) throw Object.assign(new Error("Document exceeds the encrypted storage limit. Upload a shorter document."), { status: 413 });
    if (status === 409) throw Object.assign(new Error("Conversation changed. Please retry your question."), { status: 409 });
    throw Object.assign(new Error("Encrypted document service is unavailable. Please try again."), { status: 503 });
  }
}

export function rankPassages(document: LegalDocument, query: string) {
  const cleanQuery = query.toLowerCase().trim();
  const words = cleanQuery.split(/\s+/).filter(word => word.length > 2);
  return document.analysis.clauses
    .map(clause => {
      const lowerOriginal = (clause.original || "").toLowerCase();
      const lowerHeading = (clause.heading || "").toLowerCase();
      const lowerPlain = (clause.plain || "").toLowerCase();
      let score = 0;
      if (cleanQuery && lowerOriginal.includes(cleanQuery)) score += 10;
      for (const word of words) {
        if (lowerHeading.includes(word)) score += 3;
        if (lowerOriginal.includes(word)) score += 2;
        if (lowerPlain.includes(word)) score += 1;
      }
      return { id: clause.id, text: clause.original || "", score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

export async function putDocument(session: string, document: LegalDocument): Promise<{ documentId: string }> {
  return request(session, document.id, "PUT", { document });
}

export async function getDocument<T = LegalDocument>(session: string, id: string): Promise<T> {
  return request(session, id, "GET");
}

export async function retrieveDocument(session: string, id: string, query: string): Promise<{ passages: { id: string; text: string; score: number }[] }> {
  return request(session, id, "POST", { query }, "/retrieve");
}

export async function deleteDocument(session: string, id: string): Promise<void> {
  await request(session, id, "DELETE");
}
