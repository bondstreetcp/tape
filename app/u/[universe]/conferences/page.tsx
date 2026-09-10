import ConferenceInbox from "@/components/ConferenceInbox";
export const dynamic = "force-dynamic";
export default async function ConferencesPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  return <ConferenceInbox universe={universe} />;
}
