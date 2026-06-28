// QoQ 13F Story — a GLM-written narrative of what the famous investors COLLECTIVELY did last
// quarter (the rotation themes), built from the consensus buys/sells across the 13F roster and
// shown as a banner atop the Super-Investors page. Client-safe (type only). Decision-support.

export interface StoryTheme {
  heading: string; // e.g. "Rotating into healthcare"
  detail: string; // the read — what it suggests
  tickers: string[];
}

export interface ThirteenFStory {
  generatedAt: string;
  asOf: string | null; // the quarter the filings cover
  tldr: string; // the one-paragraph headline of the quarter
  themes: StoryTheme[];
}
