import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);

export interface NewsItem {
  title: string;
  publisher: string;
  link: string;
  time: string | null; // ISO
  tickers: string[];
}

export async function getNews(query: string, count = 12): Promise<NewsItem[]> {
  try {
    const r: any = await yf.search(
      query,
      { newsCount: count, quotesCount: 0, enableNavLinks: false, enableEnhancedTrivialQuery: false } as any,
      { validateResult: false },
    );
    return (r.news || [])
      .map((n: any) => ({
        title: n.title || "",
        publisher: n.publisher || "",
        link: n.link || "",
        time: n.providerPublishTime ? new Date(n.providerPublishTime).toISOString() : null,
        tickers: (n.relatedTickers || []).filter((t: string) => t && !t.startsWith("^")).slice(0, 4),
      }))
      .filter((n: NewsItem) => n.title && n.link);
  } catch {
    return [];
  }
}
