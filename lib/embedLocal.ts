/**
 * ⚠ SERVER / TOOLING ONLY — local-CPU text embeddings (bge-small-en-v1.5, 384-d) via
 * @huggingface/transformers (ONNX). NEVER import this from app/ or any client component: it pulls a
 * heavy inference runtime (onnxruntime + model weights) and must stay OUT of the Next.js bundle. It is
 * imported ONLY by scripts/refresh-filing-index.ts (the nightly index build) — the same "nightly-only,
 * the app just reads the precomputed output" split as every other feed. Pure Node, no GPU, runs
 * identically on GitHub Actions and the NAS run-tick container.
 *
 * Determinism: the model is loaded by its fixed HF id and mean-pooled + L2-normalized, so document and
 * query vectors are comparable across runners. Weights cache into a gitignored .hf-cache/ dir — one
 * ~30MB fetch on a cold cache, then zero network (CI actions/cache-able; persists on the NAS). To go
 * strictly zero-fetch, vendor the ONNX into a committed dir and set env.localModelPath +
 * env.allowRemoteModels=false — the call sites below are unchanged.
 */
import path from "path";

export const EMBED_MODEL = "bge-small-en-v1.5";
export const EMBED_DIM = 384;
const HF_MODEL = "Xenova/bge-small-en-v1.5";

// Lazily initialize a single feature-extraction pipeline (weights load once, ~5s).
let _pipe: Promise<(text: string, opts: object) => Promise<{ data: Float32Array }>> | null = null;
function getPipe() {
  if (!_pipe) {
    _pipe = (async () => {
      const tf = await import("@huggingface/transformers");
      tf.env.cacheDir = path.join(process.cwd(), ".hf-cache"); // stable, gitignored, CI-cacheable
      // Pin the quantization (q8, ~30MB) so every runner loads byte-identical weights → comparable
      // vectors across GitHub Actions and the NAS. The refresh script's model/dim guard discards any
      // prior archive built under a different EMBED_MODEL, so a future swap can't blend vector spaces.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await tf.pipeline("feature-extraction", HF_MODEL, { dtype: "q8" })) as any;
    })();
  }
  return _pipe;
}

/** Embed one string → a 384-float unit vector (mean-pooled, L2-normalized). */
export async function embed(text: string): Promise<number[]> {
  const pipe = await getPipe();
  const out = await pipe(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

/** Embed many strings sequentially (bge-small is CPU-cheap; a nightly batch of ~hundreds is seconds).
 *  Sequential keeps memory flat and is plenty fast — this is a background job, not a hot path. */
export async function embedMany(texts: string[], onProgress?: (done: number, total: number) => void): Promise<number[][]> {
  const pipe = await getPipe();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    const o = await pipe(texts[i], { pooling: "mean", normalize: true });
    out.push(Array.from(o.data));
    if (onProgress && (i % 25 === 0 || i === texts.length - 1)) onProgress(i + 1, texts.length);
  }
  return out;
}
