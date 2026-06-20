import { redirect } from "next/navigation";

// Financials are now a tab on the unified ticker page — keep this route working
// for old links by redirecting to the Statements tab.
export default async function FinancialsPage({
  params,
}: {
  params: Promise<{ universe: string; symbol: string }>;
}) {
  const { universe, symbol } = await params;
  redirect(`/u/${universe}/stock/${encodeURIComponent(symbol)}?tab=statements`);
}
