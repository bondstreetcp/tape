import Briefing from "@/components/Briefing";

export const metadata = { title: "Daily Briefing" };

export default function BriefingPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Daily Briefing</h1>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-3)]">
          Reuters <span className="text-[var(--text-2)]">Morning News Call</span> and{" "}
          <span className="text-[var(--text-2)]">The Day Ahead</span>, fetched and parsed each market morning — top news,
          stocks to watch, analyst moves, and the day&apos;s economic and earnings calendar. Private to you.
        </p>
      </header>
      <Briefing />
    </main>
  );
}
