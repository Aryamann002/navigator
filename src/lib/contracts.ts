import { z } from "zod";

export const DISCLAIMER = "Legal information, not professional advice. This tool is not a lawyer and does not replace a qualified legal professional.";
export const findingSchema = z.object({
  id: z.string(), category: z.enum(["risk", "obligation", "date"]),
  title: z.string(), description: z.string(), severity: z.enum(["high", "medium", "low"]),
  clauseId: z.string(), quote: z.string(), date: z.string().nullable(),
});
export const clauseSchema = z.object({ id: z.string(), heading: z.string(), original: z.string(), plain: z.string(), page: z.number().int().positive() });
export const analysisSchema = z.object({ title: z.string(), documentType: z.string(), summary: z.string(), clauses: z.array(clauseSchema).min(1), findings: z.array(findingSchema), questions: z.array(z.string()) });
export type Analysis = z.infer<typeof analysisSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type Message = { role: "user" | "assistant"; content: string; citations?: string[] };
export type LegalDocument = { id: string; filename: string; uploadedAt: string; pageCount: number; text: string; analysis: Analysis; messages: Message[]; checked: string[]; sample?: boolean };
export type ServiceStatus = { ready: boolean; missing: string[]; storage: "encrypted-cloud" | "unavailable"; model: string };
