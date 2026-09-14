import { z } from "zod";

export const DISCLAIMER = "Legal information, not professional advice. This tool is not a lawyer and does not replace a qualified legal professional.";
export const findingSchema = z.object({
  id: z.string().max(128), category: z.enum(["risk", "obligation", "date"]),
  title: z.string().max(300), description: z.string().max(3000), severity: z.enum(["high", "medium", "low"]),
  clauseId: z.string().max(128), quote: z.string().max(3000), date: z.string().max(100).nullable(),
});
export const clauseSchema = z.object({ id: z.string().max(128), heading: z.string().max(500), original: z.string().max(160_000), plain: z.string().max(6000), page: z.number().int().positive().max(100) });
export const analysisSchema = z.object({ title: z.string().max(300), documentType: z.string().max(300), summary: z.string().max(6000), clauses: z.array(clauseSchema).min(1).max(1000), findings: z.array(findingSchema).max(500), questions: z.array(z.string().max(1000)).max(50) });
export const messageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(6000), citations: z.array(z.string().max(128)).max(20).optional() });
export const legalDocumentSchema = z.object({
  id: z.string().uuid(), filename: z.string().min(1).max(200), uploadedAt: z.string().datetime(), pageCount: z.number().int().positive().max(100),
  text: z.string().max(160_000), analysis: analysisSchema, messages: z.array(messageSchema).max(100), checked: z.array(z.string().max(128)).max(100), sample: z.boolean().optional(),
});
export type Analysis = z.infer<typeof analysisSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type Message = z.infer<typeof messageSchema>;
export type LegalDocument = z.infer<typeof legalDocumentSchema>;
export type ServiceStatus = { ready: boolean; missing: string[]; storage: "encrypted-cloud" | "browser-session" | "local-memory" | "unavailable"; model: string };
