import { redirect } from "next/navigation";

// The Daily Briefing (Reuters wire) merged into the Daily Desk — one page for the AI brief + the
// news wire. Old bookmarks land here, so redirect rather than 404.
export default async function BriefingRedirect({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  redirect(`/u/${universe}/morning-desk`);
}
