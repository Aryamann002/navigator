import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const MAX_CHUNKS = 128;
export const MAX_TEXT_BYTES = 160_000;
export const MAX_PAYLOAD_BYTES = 750_000;
export const SESSION_SECONDS = 86_400;

export function fail(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

export function encryptionKey(value) {
  value = value?.trim();
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw fail(503, "Document encryption is not configured.");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw fail(503, "Document encryption is not configured.");
  return key;
}

export function documentPath(session, id) {
  if (typeof session !== "string" || !/^[a-f0-9]{64}$/.test(session)) throw fail(401, "A valid session is required.");
  if (typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) throw fail(400, "Invalid document ID.");
  return `legalSessions/${createHash("sha256").update(session).digest("hex")}/legalDocuments/${id}`;
}

export function seal(value, key, scope) {
  const plaintext = Buffer.from(JSON.stringify(value));
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw fail(413, "Document record exceeds the storage limit.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(scope));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { version: 1, iv, ciphertext, tag: cipher.getAuthTag() };
}

export function unseal(record, key, scope) {
  if (record?.version !== 1) throw fail(500, "Unsupported encrypted record.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv));
  decipher.setAAD(Buffer.from(scope));
  decipher.setAuthTag(Buffer.from(record.tag));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.ciphertext)), decipher.final()]).toString("utf8"));
}

export function chunkText(text) {
  if (typeof text !== "string" || !text.trim()) throw fail(400, "Document text is required.");
  if (Buffer.byteLength(text) > MAX_TEXT_BYTES) throw fail(413, "Document text exceeds 160 KB. Upload a shorter document.");
  const characters = Array.from(text);
  const chunks = [];
  for (let start = 0; start < characters.length; start += 1440) {
    chunks.push({ id: `passage-${chunks.length + 1}`, text: characters.slice(start, start + 1600).join("") });
    if (chunks.length > MAX_CHUNKS) throw fail(413, "Document exceeds the retrieval limit.");
    if (start + 1600 >= characters.length) break;
  }
  return chunks;
}

export function cosine(left, right) {
  if (left.length !== right.length || !left.length) throw fail(500, "Embedding dimensions do not match.");
  let product = 0, leftNorm = 0, rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    if (!Number.isFinite(left[index]) || !Number.isFinite(right[index])) throw fail(500, "Invalid embedding.");
    product += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? product / Math.sqrt(leftNorm * rightNorm) : 0;
}
