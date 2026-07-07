// US economic releases shown in the macro calendar, each mapped to a FRED series
// so the dashboard can show recent prints (and, for GDP, the Atlanta Fed nowcast)
// when a row is expanded. Kept separate from fred.ts/econCalendar.ts so both can
// import it without a cycle.

export type ReleaseTransform = "yoy" | "mom" | "momChange" | "level";

export interface ReleaseDef {
  key: string;
  label: string;
  fredId: string;
  transform: ReleaseTransform; // how the headline number is derived from the series
  unit: string; // suffix shown after values ("%", "K", "M", "")
  scale: number; // multiply raw values (e.g. 0.001 to turn thousands → millions)
  chart: "bar" | "line"; // bars for changes/rates, line for levels
  hint: string; // one-line description of what the print measures
}

export const RELEASES: ReleaseDef[] = [
  { key: "payrolls", label: "Nonfarm payrolls", fredId: "PAYEMS", transform: "momChange", unit: "K", scale: 1, chart: "bar", hint: "month-over-month change in jobs (thousands)" },
  { key: "cpi", label: "CPI inflation", fredId: "CPIAUCSL", transform: "yoy", unit: "%", scale: 1, chart: "bar", hint: "headline consumer prices, year-over-year" },
  { key: "ppi", label: "PPI (final demand)", fredId: "PPIFIS", transform: "yoy", unit: "%", scale: 1, chart: "bar", hint: "producer prices, year-over-year" },
  { key: "gdp", label: "Real GDP", fredId: "A191RL1Q225SBEA", transform: "level", unit: "%", scale: 1, chart: "bar", hint: "annualized quarter-over-quarter growth" },
  { key: "pce", label: "Core PCE", fredId: "PCEPILFE", transform: "yoy", unit: "%", scale: 1, chart: "bar", hint: "Fed's preferred inflation gauge, year-over-year" },
  { key: "retail", label: "Retail sales", fredId: "RSAFS", transform: "mom", unit: "%", scale: 1, chart: "bar", hint: "advance retail sales, month-over-month" },
  { key: "indpro", label: "Industrial production", fredId: "INDPRO", transform: "mom", unit: "%", scale: 1, chart: "bar", hint: "industrial output, month-over-month" },
  { key: "durable", label: "Durable goods orders", fredId: "DGORDER", transform: "mom", unit: "%", scale: 1, chart: "bar", hint: "new orders for durable goods, month-over-month" },
  { key: "housing", label: "Housing starts", fredId: "HOUST", transform: "level", unit: "M", scale: 0.001, chart: "line", hint: "annualized housing starts (millions of units)" },
  { key: "jolts", label: "Job openings (JOLTS)", fredId: "JTSJOL", transform: "level", unit: "M", scale: 0.001, chart: "line", hint: "total job openings (millions)" },
  { key: "claims", label: "Initial jobless claims", fredId: "ICSA", transform: "level", unit: "K", scale: 0.001, chart: "line", hint: "weekly initial unemployment claims (thousands)" },
  { key: "sentiment", label: "Consumer sentiment", fredId: "UMCSENT", transform: "level", unit: "", scale: 1, chart: "line", hint: "University of Michigan sentiment index" },
];

// Calendar event label (from econCalendar) → release key.
export const LABEL_TO_RELEASE: Record<string, string> = {
  "Jobs report (NFP)": "payrolls",
  "CPI": "cpi",
  "PPI": "ppi",
  "GDP": "gdp",
  "PCE / personal income": "pce",
  "Retail sales": "retail",
  "Industrial production": "indpro",
  "Durable goods": "durable",
  "Housing starts": "housing",
  "JOLTS": "jolts",
  "Jobless claims": "claims",
  "Consumer sentiment": "sentiment",
  "Consumer sentiment (prelim)": "sentiment",
};

// Computed per-release data carried in the macro snapshot.
export interface ReleaseData {
  key: string;
  label: string;
  unit: string;
  chart: "bar" | "line";
  hint: string;
  history: [string, number][]; // [date, transformed value]
  latest: number | null;
  latestDate: string | null;
  prior: number | null;
  nowcast?: number | null; // GDPNow for GDP
}
