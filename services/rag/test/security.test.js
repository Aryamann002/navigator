import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { chunkText, cosine, documentPath, encryptionKey, seal, unseal } from "../core.js";
import { createHandler } from "../server.js";

test("authenticated encryption rejects tampering and cross-session record swaps", () => {
  const key = randomBytes(32), session = randomBytes(32).toString("hex"), id = randomUUID();
  const scope = documentPath(session, id);
  const value = { text: "Confidential terms", vector: [1, 0.5, -0.1] };
  const encrypted = seal(value, key, scope);
  assert.deepEqual(unseal(encrypted, key, scope), value);
  assert.equal(encrypted.ciphertext.includes(Buffer.from(value.text)), false);
  assert.notDeepEqual(seal(value, key, scope).iv, encrypted.iv);
  assert.throws(() => unseal(encrypted, key, documentPath(randomBytes(32).toString("hex"), id)));
  assert.throws(() => unseal(encrypted, randomBytes(32), scope));
  encrypted.ciphertext[0] ^= 1;
  assert.throws(() => unseal(encrypted, key, scope));
  assert.throws(() => documentPath("../another-session", id));
  assert.throws(() => documentPath(session, "../another-document"));
  assert.throws(() => encryptionKey("short"));
  assert.deepEqual(encryptionKey(key.toString("base64")), key);
});

test("retrieval chunks preserve Unicode and bound source size", () => {
  const text = "A\u{1f600}".repeat(1500);
  const chunks = chunkText(text);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].text + Array.from(chunks[1].text).slice(160).join(""), text);
  assert.throws(() => chunkText("x".repeat(160001)), { status: 413 });
  assert.throws(() => chunkText("   "), { status: 400 });
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.throws(() => cosine([1], [1, 2]));
});

function memoryFirestore() {
  const records = new Map();
  let version = 0;
  const snapshot = (path) => ({
    exists: records.has(path), ref: doc(path), updateTime: records.get(path)?.version,
    data: () => records.get(path)?.data,
  });
  function doc(path) {
    return {
      path, get: async () => snapshot(path),
      update: async (patch, precondition) => {
        const record = records.get(path);
        if (!record || record.version !== precondition.lastUpdateTime) throw Object.assign(new Error("Conflict"), { code: 9 });
        records.set(path, { data: { ...record.data, ...patch }, version: ++version });
      },
      collection: (name) => ({
        doc: (id) => doc(`${path}/${name}/${id}`),
        limit: (limit) => ({ get: async () => {
          const docs = [...records.keys()].filter((key) => key.startsWith(`${path}/${name}/`)).slice(0, limit).map(snapshot);
          return { docs, size: docs.length };
        } }),
      }),
    };
  }
  return {
    records, doc,
    batch: () => {
      const writes = [];
      return {
        create: (ref, data) => writes.push({ ref, data }),
        delete: (ref) => writes.push({ ref }),
        commit: async () => {
          for (const { ref, data } of writes) if (data && records.has(ref.path)) throw new Error("Exists");
          for (const { ref, data } of writes) {
            if (data) records.set(ref.path, { data, version: ++version });
            else records.delete(ref.path);
          }
        },
      };
    },
  };
}

test("HTTP storage isolates sessions, reuses embeddings, preserves history, expires and deletes", async (context) => {
  const db = memoryFirestore(), key = randomBytes(32);
  let embeddingCalls = 0;
  let rejectEmbedding = false;
  const server = createServer(createHandler({ db, key, embed: async () => {
    embeddingCalls++;
    if (rejectEmbedding) throw Object.assign(new Error("Private provider error payload"), { status: 400 });
    return [1, 0];
  } }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const owner = randomBytes(32).toString("hex"), other = randomBytes(32).toString("hex"), id = randomUUID();
  const document = { id, text: "Payment is due in thirty days.", messages: [] };
  const call = (session, method, body, suffix = "") => fetch(`${origin}/documents/${id}${suffix}`, {
    method, headers: { "x-legal-session": session, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal((await call(owner, "PUT", { document })).status, 200);
  assert.equal(embeddingCalls, 1);
  assert.deepEqual(await (await call(owner, "GET")).json(), document);
  assert.equal((await call(other, "GET")).status, 404);
  assert.equal((await call(other, "POST", { query: "Payment?" }, "/retrieve")).status, 404);
  assert.equal(embeddingCalls, 1);
  assert.equal((await call(other, "DELETE")).status, 204);
  assert.equal((await call(owner, "GET")).status, 200);
  const retrieval = await (await call(owner, "POST", { query: "Payment?" }, "/retrieve")).json();
  assert.equal("document" in retrieval, false);
  assert.equal(retrieval.passages[0].text, document.text);
  assert.equal(retrieval.passages[0].score, 1);
  const updated = { ...document, messages: [{ role: "user", content: "Payment?" }] };
  assert.equal((await call(owner, "PUT", { document: updated })).status, 200);
  assert.equal(embeddingCalls, 2);
  assert.equal((await call(owner, "PUT", { document })).status, 409);
  assert.equal((await call(owner, "PUT", { document: { ...updated, text: "Changed" } })).status, 409);
  const stored = db.records.get(documentPath(owner, id));
  assert.equal("text" in stored.data, false);
  stored.data.expiresAt = Timestamp.fromMillis(Date.now() - 1);
  assert.equal((await call(owner, "GET")).status, 404);
  assert.equal((await call(owner, "DELETE")).status, 204);
  assert.equal(db.records.size, 0);
  assert.equal((await call(owner, "PUT", { document: updated })).status, 404);
  assert.equal(embeddingCalls, 2);
  assert.equal(db.records.size, 0);
  assert.equal((await call(owner, "PUT", { document: { ...document, extra: "x".repeat(800_000) } })).status, 413);
  assert.equal(db.records.size, 0);
  rejectEmbedding = true;
  const failedUpload = await call(owner, "PUT", { document });
  assert.equal(failedUpload.status, 503);
  assert.equal((await failedUpload.text()).includes("Private provider"), false);
  assert.equal(db.records.size, 0);
});
