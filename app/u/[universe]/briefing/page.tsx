import { redirect } from "next/navigation";

// The Daily Briefing (Reuters wire) is now the News Wire sub-tab of the Daily Desk. Old bookmarks
// land here, so redirect straight to that tab rather than 404.
export default async function BriefingRedirect({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  redirect(`/u/${universe}/morning-desk?tab=wire`);
}
