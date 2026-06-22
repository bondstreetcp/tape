/**
 * Raw-PDF blob storage in a PRIVATE Supabase Storage bucket. Keeps the source PDF so a
 * note can be re-opened; the searchable text/extraction live in Postgres. Uses the
 * SUPABASE_SECRET_KEY (service-role) server-side only — never exposed to the browser.
 * No-ops gracefully if Storage isn't configured (extraction/search still work).
 */
const SUPA_URL = process.env.SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const BUCKET = process.env.RESEARCH_BUCKET || "research";

export const blobConfigured = () => !!(SUPA_URL && SECRET);
const auth = () => ({ apikey: SECRET as string, Authorization: `Bearer ${SECRET}` });

let bucketReady = false;
async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  // create the private bucket; ignore "already exists"
  try {
    await fetch(`${SUPA_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
    });
  } catch { /* ignore */ }
  bucketReady = true;
}

/** Upload (upsert) a PDF; returns the storage key, or null if Storage isn't configured. */
export async function uploadPdf(id: string, buf: Buffer | Uint8Array): Promise<string | null> {
  if (!blobConfigured()) return null;
  await ensureBucket();
  const key = `${id}.pdf`;
  try {
    const res = await fetch(`${SUPA_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/pdf", "x-upsert": "true" },
      body: buf as any,
    });
    return res.ok ? key : null;
  } catch {
    return null;
  }
}

/** A short-lived signed URL to view a stored PDF (default 10 min). */
export async function signedPdfUrl(key: string, expiresIn = 600): Promise<string | null> {
  if (!blobConfigured()) return null;
  try {
    const res = await fetch(`${SUPA_URL}/storage/v1/object/sign/${BUCKET}/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn }),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    return j?.signedURL ? `${SUPA_URL}/storage/v1${j.signedURL}` : null;
  } catch {
    return null;
  }
}
