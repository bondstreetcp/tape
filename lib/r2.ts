/**
 * Minimal Cloudflare R2 object put/get for the tooling scripts (SigV4 via aws4fetch — tiny, no AWS
 * SDK). Reads the same LAKE_S3_* env the lake uses; `.env.local` for local runs, real env in CI /
 * Vercel. Used to ship the operational data/ tree to R2 as a single tarball (build-time hydration),
 * so bulk data can eventually leave the git repo. Server/tooling only — never imported by the app.
 */
import { AwsClient } from "aws4fetch";
import { loadLocalEnv } from "./localEnv";
import { deadline } from "./deadline";

loadLocalEnv();

// Normalize the endpoint to host-only: tolerate a pasted "https://" scheme, surrounding quotes,
// whitespace, or a trailing slash — otherwise `https://${EP}/...` doubles the scheme and DNS-fails.
const EP = (process.env.LAKE_S3_ENDPOINT || "").trim().replace(/^["']|["']$/g, "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
const BUCKET = process.env.LAKE_S3_BUCKET;
const KEY = process.env.LAKE_S3_KEY_ID;
const SECRET = process.env.LAKE_S3_SECRET;

export const r2Configured = (): boolean => !!(EP && BUCKET && KEY && SECRET);

function client(): AwsClient {
  if (!r2Configured()) throw new Error("R2 not configured (LAKE_S3_* missing)");
  return new AwsClient({ accessKeyId: KEY!, secretAccessKey: SECRET!, service: "s3", region: "auto" });
}
const objUrl = (key: string) => `https://${EP}/${BUCKET}/${key.replace(/^\/+/, "")}`;

/** PUT one object. body is held in memory (fine for a ~40 MB tarball). Throws on non-2xx — the error
 *  message never includes the credentials. */
export async function putObject(key: string, body: Uint8Array, contentType = "application/octet-stream"): Promise<void> {
  // aws4fetch accepts a Uint8Array body (smoke-verified); the DOM BodyInit type is stricter about the
  // ArrayBuffer generic than reality, so cast rather than copy the ~35 MB into a Blob.
  const res = await client().fetch(objUrl(key), { method: "PUT", body: body as unknown as BodyInit, headers: { "content-type": contentType }, signal: deadline(180_000) });
  if (!res.ok) throw new Error(`R2 PUT ${key} → ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}`);
}

/** GET one object as a Buffer. Throws on non-2xx.
 *
 *  The failure message carries R2's own XML error CODE and both clocks, because a bare "→ 403" is
 *  undiagnosable: InvalidAccessKeyId (wrong key), SignatureDoesNotMatch (wrong secret, or a stray
 *  \r from a CRLF-saved env file), AccessDenied (token lacks the bucket) and RequestTimeTooSkewed
 *  (host clock drifted >15min — SigV4 signs a timestamp) ALL surface as 403. The Date header is the
 *  server's real UTC; comparing it to ours names a skew instantly. No secret is ever in the body —
 *  S3-style errors echo only the access-key ID, never the signing key. */
export async function getObject(key: string): Promise<Buffer> {
  const res = await client().fetch(objUrl(key), { method: "GET", signal: deadline(180_000) });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    const serverDate = res.headers.get("date");
    const skew = serverDate ? Math.round((Date.now() - Date.parse(serverDate)) / 1000) : null;
    const clocks = serverDate ? ` [r2 clock="${serverDate}" ours="${new Date().toUTCString()}" skew=${skew}s]` : "";
    throw new Error(`R2 GET ${key} → ${res.status} ${body}${clocks}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
