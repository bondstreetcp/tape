/**
 * Provider-agnostic OpenAI-compatible chat client (OpenRouter by default).
 *
 * Config from env — for local `tsx` runs we fall back to reading .env.local the
 * same way scripts/refresh-trump.ts / refresh-catalysts.ts do, since tsx does NOT
 * auto-load it; CI injects the variables directly.
 *
 *   OPENROUTER_API_KEY  (required)
 *   LLM_BASE_URL        (default https://openrouter.ai/api/v1)
 *   LLM_MODEL           (default z-ai/glm-5.2)
 *
 * chatJSON() requests strict JSON (response_format json_object), parses the
 * model's reply, and validate-and-retries up to 3× with backoff on a bad
 * response (non-OK, empty content, or unparseable JSON). chatText() returns
 * plain text. Both return null when the call ultimately fails.
 */
import { promises as fs } from "fs";
import path from "path";

const DEFAULT_BASE = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "z-ai/glm-5.2";

let _key: string | null = null;

/** Resolve the API key from env, or (for local tsx runs) from .env.local. */
async function apiKey(): Promise<string> {
  if (_key != null) return _key;
  if (process.env.OPENROUTER_API_KEY) {
    _key = process.env.OPENROUTER_API_KEY.trim();
    return _key;
  }
  const env = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf8").catch(() => "");
  _key = (env.match(/^OPENROUTER_API_KEY\s*=\s*(.+)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
  return _key;
}

function baseUrl(): string {
  return (process.env.LLM_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
}
function model(): string {
  return process.env.LLM_MODEL || DEFAULT_MODEL;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ChatOpts {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  retries?: number;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function callChat(
  messages: ChatMessage[],
  opts: ChatOpts,
  jsonMode: boolean,
): Promise<string | null> {
  const key = await apiKey();
  if (!key) {
    console.warn("lib/llm: OPENROUTER_API_KEY not set (env or .env.local) — skipping LLM call.");
    return null;
  }
  const url = `${baseUrl()}/chat/completions`;
  const retries = opts.retries ?? 3;
  const body: Record<string, unknown> = {
    model: opts.model || model(),
    temperature: opts.temperature ?? 0.1,
    messages,
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": "Tape",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const snippet = (await res.text().catch(() => "")).slice(0, 160);
        // Rate-limit / transient server errors → back off and retry.
        if (res.status === 429 || res.status >= 500) {
          await sleep(1500 * (attempt + 1));
          continue;
        }
        console.warn(`lib/llm: ${res.status} ${snippet}`);
        if (attempt === retries - 1) return null;
        await sleep(1000 * (attempt + 1));
        continue;
      }
      const j: any = await res.json();
      const content: string = j?.choices?.[0]?.message?.content ?? "";
      if (!content.trim()) {
        if (attempt === retries - 1) return null;
        await sleep(1000 * (attempt + 1));
        continue;
      }
      return content;
    } catch (e: any) {
      if (attempt === retries - 1) {
        console.warn(`lib/llm: ${e?.message || e}`);
        return null;
      }
      await sleep(1200 * (attempt + 1));
    }
  }
  return null;
}

/** Extract the first balanced JSON object/array from a possibly-fenced reply. */
function parseJson<T = any>(raw: string): T | null {
  let s = raw.trim();
  // Strip ```json … ``` fences if the model added them despite json_object mode.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    // Fall back to the first {...} or [...] span.
    const start = s.search(/[[{]/);
    if (start >= 0) {
      const open = s[start];
      const close = open === "{" ? "}" : "]";
      const end = s.lastIndexOf(close);
      if (end > start) {
        try {
          return JSON.parse(s.slice(start, end + 1)) as T;
        } catch {
          /* fall through */
        }
      }
    }
    return null;
  }
}

/**
 * Ask the model for a JSON object. Validate-and-retries up to 3× on non-OK,
 * empty, or unparseable responses. Returns the parsed object or null.
 */
export async function chatJSON<T = any>(system: string, user: string, opts: ChatOpts = {}): Promise<T | null> {
  const retries = opts.retries ?? 3;
  for (let attempt = 0; attempt < retries; attempt++) {
    const content = await callChat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { ...opts, retries: 1 }, // each loop iteration is one transport try; we own the JSON-validate retry here
      true,
    );
    if (content) {
      const parsed = parseJson<T>(content);
      if (parsed != null) return parsed;
    }
    if (attempt < retries - 1) await sleep(1000 * (attempt + 1));
  }
  return null;
}

/** Ask the model for plain text. Returns the text or null. */
export async function chatText(system: string, user: string, opts: ChatOpts = {}): Promise<string | null> {
  const content = await callChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    opts,
    false,
  );
  return content ? content.trim() : null;
}
