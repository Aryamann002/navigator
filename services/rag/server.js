import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import { chunkText, cosine, documentPath, encryptionKey, fail, MAX_CHUNKS, MAX_PAYLOAD_BYTES, seal, SESSION_SECONDS, unseal } from "./core.js";

export function createHandler({ db, key, embed }) {
  async function load(path) {
    const snapshot = await db.doc(path).get();
    if (!snapshot.exists || snapshot.data().expiresAt.toMillis() <= Date.now()) throw fail(404, "Document not found or session expired.");
    const stored = snapshot.data();
    return { ...stored, updateTime: snapshot.updateTime, document: unseal(stored.encrypted, key, path) };
  }

  return async function handler(request, response) {
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    try {
      const url = new URL(request.url, "http://localhost");
      if (request.method === "GET" && url.pathname === "/health") {
        response.end(JSON.stringify({ ready: true }));
        return;
      }
      const match = /^\/documents\/([^/]+)(\/retrieve)?$/.exec(url.pathname);
      if (!match) throw fail(404, "Not found.");
      const path = documentPath(request.headers["x-legal-session"], match[1]);
      const ref = db.doc(path);
      let body;
      if (request.method === "PUT" || request.method === "POST") {
        if (!request.headers["content-type"]?.startsWith("application/json")) throw fail(415, "JSON is required.");
        let size = 0;
        const buffers = [];
        for await (const buffer of request.iterator({ destroyOnReturn: false })) {
          size += buffer.length;
          if (size > MAX_PAYLOAD_BYTES) throw fail(413, "Document record exceeds the storage limit.");
          buffers.push(buffer);
        }
        try { body = JSON.parse(Buffer.concat(buffers).toString("utf8")); }
        catch { throw fail(400, "Invalid JSON."); }
      }
      if (request.method === "PUT" && !match[2]) {
        const document = body?.document;
        if (!document || document.id !== match[1] || !Array.isArray(document.messages)) throw fail(400, "Invalid document record.");
        const chunks = chunkText(document.text);
        let previous;
        try { previous = await load(path); }
        catch (error) { if (error.status !== 404) throw error; }
        if (!previous && document.messages.length) throw fail(404, "Document not found or session expired.");
        const expiresAt = previous?.expiresAt ?? Timestamp.fromMillis(Date.now() + SESSION_SECONDS * 1000);
        const encrypted = seal(document, key, path);
        if (previous) {
          if (previous.document.text !== document.text) throw fail(409, "Upload changed text as a new document.");
          const priorMessages = previous.document.messages;
          if (JSON.stringify(priorMessages) !== JSON.stringify(document.messages.slice(0, priorMessages.length))) throw fail(409, "Conversation changed. Please retry your question.");
          try { await ref.update({ encrypted }, { lastUpdateTime: previous.updateTime }); }
          catch (error) { if (error.code === 9) throw fail(409, "Conversation changed. Please retry your question."); throw error; }
        } else {
          const vectors = [];
          // ponytail: at most 128 chunks and four concurrent requests; use a queued ingestion job for larger documents.
          for (let offset = 0; offset < chunks.length; offset += 4) {
            vectors.push(...await Promise.all(chunks.slice(offset, offset + 4).map(async (chunk) => ({ ...chunk, vector: await embed(chunk.text, "RETRIEVAL_DOCUMENT") }))));
          }
          const batch = db.batch();
          batch.create(ref, { encrypted, expiresAt, chunkCount: chunks.length });
          for (const chunk of vectors) {
            const chunkRef = ref.collection("legalChunks").doc(chunk.id);
            batch.create(chunkRef, { encrypted: seal(chunk, key, chunkRef.path), expiresAt });
          }
          await batch.commit();
        }
        response.end(JSON.stringify({ documentId: document.id }));
      } else if (request.method === "GET" && !match[2]) {
        response.end(JSON.stringify((await load(path)).document));
      } else if (request.method === "POST" && match[2]) {
        if (typeof body?.query !== "string" || !body.query.trim() || body.query.length > 4000) throw fail(400, "A question of at most 4000 characters is required.");
        const stored = await load(path);
        const queryVector = await embed(body.query, "RETRIEVAL_QUERY");
        const snapshot = await ref.collection("legalChunks").limit(MAX_CHUNKS).get();
        if (snapshot.size !== stored.chunkCount) throw fail(503, "Document index is incomplete. Upload the document again.");
        // ponytail: linear scan is bounded to one session-owned document; use a confidential vector index above 128 chunks.
        const passages = snapshot.docs.map((chunk) => {
          const data = unseal(chunk.data().encrypted, key, chunk.ref.path);
          return { id: data.id, text: data.text, score: cosine(queryVector, data.vector) };
        }).sort((left, right) => right.score - left.score).slice(0, 8);
        response.end(JSON.stringify({ passages }));
      } else if (request.method === "DELETE" && !match[2]) {
        const chunks = await ref.collection("legalChunks").limit(MAX_CHUNKS).get();
        const batch = db.batch();
        for (const chunk of chunks.docs) batch.delete(chunk.ref);
        batch.delete(ref);
        await batch.commit();
        response.statusCode = 204;
        response.end();
      } else {
        throw fail(405, "Method not allowed.");
      }
    } catch (error) {
      const status = error.expose && Number.isInteger(error.status) ? error.status : 503;
      if (status === 413) {
        response.shouldKeepAlive = false;
        response.setHeader("Connection", "close");
        request.resume();
      }
      response.statusCode = status;
      response.end(JSON.stringify({ error: status < 500 ? error.message : "Encrypted document service is unavailable. Please try again." }));
    }
  };
}

export function startServer() {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
  const model = process.env.VERTEX_EMBEDDING_MODEL || "gemini-embedding-001";
  if (!project || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)) throw new Error("GOOGLE_CLOUD_PROJECT is required.");
  if (!/^[a-z]+-[a-z]+\d$/.test(location) || !/^[a-zA-Z0-9@._-]+$/.test(model)) throw new Error("Invalid Vertex embedding configuration.");
  const key = encryptionKey(process.env.DOCUMENT_ENCRYPTION_KEY);
  initializeApp({ credential: applicationDefault(), projectId: project });
  const db = getFirestore();
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`;
  const embed = async (text, taskType) => {
    const client = await auth.getClient();
    const result = await client.request({
      url: endpoint, method: "POST", timeout: 30_000,
      data: { instances: [{ content: text, task_type: taskType }], parameters: { autoTruncate: false, outputDimensionality: 768 } },
    });
    const vector = result.data?.predictions?.[0]?.embeddings?.values;
    if (!Array.isArray(vector) || vector.length !== 768 || !vector.every(Number.isFinite)) throw fail(502, "Invalid embedding response.");
    return vector;
  };
  const server = createServer(createHandler({ db, key, embed }));
  server.requestTimeout = 180_000;
  server.headersTimeout = 10_000;
  server.listen(Number(process.env.PORT || 8080), process.env.K_SERVICE ? "0.0.0.0" : "127.0.0.1");
  process.on("SIGTERM", () => server.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
