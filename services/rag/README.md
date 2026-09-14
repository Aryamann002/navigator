# Encrypted Document RAG Service

This private Cloud Run service stores session-scoped documents, analysis, chat history and Vertex embeddings in Firebase Cloud Firestore. Next.js invokes it using a Google-signed ID token with the Cloud Run service origin as its audience. Browser clients never receive Google credentials or direct Firestore access.

Every document and every embedding chunk is encrypted with AES-256-GCM before writing to Firestore. The session/document/chunk path is authenticated as additional data, so moving encrypted records between sessions fails decryption. Firestore stores only encrypted payloads, expiration timestamps and chunk counts. The application key belongs in Google Secret Manager, separate from the database. Decrypted text and embeddings exist in service memory while processing; source text is sent to Vertex to generate embeddings.

## Provision and Deploy

Run from `services/rag` in PowerShell after selecting a billing-enabled Google Cloud/Firebase project. These commands create real billable resources. The account needs project administration permissions for first-time setup; existing organizations may require an administrator to grant the documented deployment roles.

```powershell
$project = "YOUR_PROJECT_ID"
$region = "us-central1"
$runtimeAccount = "legal-rag-runtime@$project.iam.gserviceaccount.com"
$frontendAccount = "legal-navigator-web@$project.iam.gserviceaccount.com"
gcloud auth login
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com aiplatform.googleapis.com secretmanager.googleapis.com iamcredentials.googleapis.com firebase.googleapis.com --project=$project
gcloud iam service-accounts create legal-rag-runtime --project=$project
gcloud iam service-accounts create legal-navigator-web --project=$project
gcloud projects add-iam-policy-binding $project --member="serviceAccount:$runtimeAccount" --role=roles/datastore.user
gcloud projects add-iam-policy-binding $project --member="serviceAccount:$runtimeAccount" --role=roles/aiplatform.user
gcloud projects add-iam-policy-binding $project --member="serviceAccount:$frontendAccount" --role=roles/aiplatform.user
gcloud projects add-iam-policy-binding $project --member="serviceAccount:$frontendAccount" --role=roles/serviceusage.serviceUsageConsumer
$projectNumber = gcloud projects describe $project --format="value(projectNumber)"
gcloud projects add-iam-policy-binding $project --member="serviceAccount:$projectNumber-compute@developer.gserviceaccount.com" --role=roles/run.builder
```

Create the `(default)` Firestore Native database only if it does not already exist. Its region is a persistent choice. Add Firebase to an existing Cloud project only if needed, then deploy the supplied deny-all client rules and ciphertext index exclusions:

```powershell
gcloud firestore databases create --database="(default)" --location=$region --type=firestore-native --project=$project
npx --yes firebase-tools login
npx --yes firebase-tools projects:addfirebase $project
npx --yes firebase-tools deploy --only firestore:rules,firestore:indexes --project=$project
```

Create the encryption secret once. Keep the same secret version for records already stored; replacing the key makes those records unreadable. The generator below pipes directly to Secret Manager without printing the key:

```powershell
node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))' | gcloud secrets create legal-document-encryption-key --data-file=- --replication-policy=automatic --project=$project
gcloud secrets add-iam-policy-binding legal-document-encryption-key --member="serviceAccount:$runtimeAccount" --role=roles/secretmanager.secretAccessor --project=$project
gcloud run deploy legal-document-rag --source=. --region=$region --project=$project --service-account=$runtimeAccount --no-allow-unauthenticated --timeout=180 --concurrency=8 --max-instances=5 --memory=512Mi --set-env-vars="GOOGLE_CLOUD_PROJECT=$project,GOOGLE_CLOUD_LOCATION=$region,VERTEX_EMBEDDING_MODEL=gemini-embedding-001" --set-secrets="DOCUMENT_ENCRYPTION_KEY=legal-document-encryption-key:1"
gcloud run services add-iam-policy-binding legal-document-rag --region=$region --project=$project --member="serviceAccount:$frontendAccount" --role=roles/run.invoker
gcloud run services describe legal-document-rag --region=$region --project=$project --format="value(status.url)"
```

Keep Cloud Run IAM authentication enabled. Do not grant `allUsers` or `allAuthenticatedUsers` invocation. The HTTP handler trusts the session header only because the IAM boundary admits the dedicated Next.js service identity. `--no-allow-unauthenticated` and the restricted invoker policy are required security configuration, not optional deployment tuning.

Enable TTL on both collection groups because deleting a Firestore parent does not delete its subcollections:

```powershell
gcloud firestore fields ttls update expiresAt --collection-group=legalDocuments --enable-ttl --project=$project
gcloud firestore fields ttls update expiresAt --collection-group=legalChunks --enable-ttl --project=$project
```

## Connect Next.js

Set these server-only environment values locally in the repository's `.env.local` and in the Vercel project environment. Never use a `NEXT_PUBLIC_` prefix.

| Variable | Value |
| --- | --- |
| `CLOUD_RUN_RAG_URL` | The HTTPS service origin printed by deployment, with no path |
| `SESSION_SECRET` | A random secret containing at least 32 characters, stable across frontend instances |
| `GOOGLE_CLOUD_PROJECT` | The same Google Cloud/Firebase project ID |
| `GOOGLE_CLOUD_LOCATION` | The region used for Vertex reasoning |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Server-only JSON credentials for `legal-navigator-web`, when not using ADC |

The bridge uses `google-auth-library` and also accepts Application Default Credentials, including a supported workload-identity configuration supplied through `GOOGLE_APPLICATION_CREDENTIALS`. A workstation's ADC file is not copied to Vercel; deployed Next.js needs its own configured Google identity. The frontend service account needs `roles/run.invoker` on this service and Vertex access for document reasoning, but no Firestore or encryption-key access.

For local ADC, use service-account impersonation. Ordinary user ADC cannot mint the Cloud Run ID token required by this bridge. Grant your user `roles/iam.serviceAccountTokenCreator` on the frontend service account, then authenticate:

```powershell
gcloud auth application-default login --impersonate-service-account=$frontendAccount
```

## Runtime and Retention

- The signed, HttpOnly, SameSite=Strict session cookie lasts 24 hours and uses the `__Host-` prefix plus Secure in production. There are no cross-device account sessions in this MVP.
- The source limit is 160,000 UTF-8 bytes; the complete analyzed document and chat record must fit within 750,000 bytes. Oversized input fails before embedding calls. Text is immutable after ingestion. Chat updates reuse embeddings and reject stale history instead of overwriting another response.
- Chunks contain at most 1,600 Unicode code points, with 160 code points of overlap. At most 128 chunks are accepted. Gemini embedding input truncation is disabled; provider token-limit errors fail ingestion rather than silently omitting text.
- Embeddings use `gemini-embedding-001`, 768 dimensions, and `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`. Retrieval decrypts only the requested session-owned document's bounded chunk collection, ranks by cosine similarity and returns eight passages alongside the trusted full document for cross-clause reasoning. This is a bounded linear scan, not a global vector index. Larger documents require queued ingestion and a confidential vector-search design.
- Access is rejected immediately after the 24-hour expiration timestamp. Firestore TTL performs physical cleanup asynchronously, typically within 24 further hours. The delete endpoint immediately removes the document and all its embedding chunks in one batch.
- All responses use `Cache-Control: private, no-store`. The service does not log source text, questions, vectors, tokens or provider error payloads.
- Source deployment uses the supplied Node 24 Dockerfile. Locally the service binds only to loopback; Cloud Run binds its required interface and relies on IAM for authentication.

## Verify

```powershell
npm ci
npm test
```

The runnable tests exercise AES-GCM tamper protection, cross-session record substitution, source bounds, Unicode chunking, HTTP ownership checks, unchanged-text embedding reuse, stale-history rejection, expiration and deletion. The HTTP tests replace Firestore/Vertex with deterministic test doubles and do not call paid services. Live IAM, Vertex quotas and Firestore persistence still require validation against the provisioned project.

Before enabling real uploads, verify that unauthenticated calls to the deployed service receive HTTP 403 and that a frontend-authenticated upload, grounded question, PDF generation and deletion succeed.

## References

- [Cloud Run source deployment and IAM build roles](https://docs.cloud.google.com/run/docs/deploying-source-code)
- [Cloud Run service-to-service authentication](https://docs.cloud.google.com/run/docs/authenticating/service-to-service)
- [Cloud Run Secret Manager integration](https://docs.cloud.google.com/run/docs/configuring/services/secrets)
- [Firebase Admin initialization](https://firebase.google.com/docs/admin/setup)
- [Vertex text embeddings request fields](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/text-embeddings-api)
- [Firestore TTL retention behavior](https://firebase.google.com/docs/firestore/ttl)
- [Application Default Credentials with service account impersonation](https://docs.cloud.google.com/docs/authentication/use-service-account-impersonation)
