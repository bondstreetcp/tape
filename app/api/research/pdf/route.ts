import { NextRequest, NextResponse } from "next/server";
import { getDoc } from "@/lib/research/store";
import { signedPdfUrl } from "@/lib/research/blob";

export const dynamic = "force-dynamic";

// GET /api/research/pdf?id=<docId> → 302 to a short-lived signed URL for the raw PDF.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const doc = await getDoc(id);
  if (!doc?.blobKey) return NextResponse.json({ error: "no stored PDF for this document" }, { status: 404 });
  const url = await signedPdfUrl(doc.blobKey);
  if (!url) return NextResponse.json({ error: "could not sign URL" }, { status: 502 });
  return NextResponse.redirect(url);
}
