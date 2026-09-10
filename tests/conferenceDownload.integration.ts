/** Opt-in real yt-dlp/FFmpeg smoke test; generated audio + localhost only, no conference access. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import type { BrowserContext } from "playwright-core";
import { downloadAudio, nonempty, runCommand } from "../scripts/conference-media";

test("real HLS download and MP3 validation commit audio and remove the temporary cookie jar", async () => {
  const config = JSON.parse(await fs.readFile(".conference-runner/config.json", "utf8"));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tape-conf-download-"));
  const server = createServer(async (req, res) => {
    const filename = path.basename(new URL(req.url!, "http://localhost").pathname);
    try {
      const bytes = await fs.readFile(path.join(dir, filename));
      res.writeHead(200, { "Content-Type": filename.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t" });
      res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  try {
    await runCommand(config.ffmpeg, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "aac", "-f", "hls", "-hls_time", "1", "-hls_playlist_type", "vod", path.join(dir, "playlist.m3u8")], 15000);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/playlist.m3u8`;
    const out = path.join(dir, "result", "audio.mp3");
    await downloadAudio({ url, referer: "http://127.0.0.1/", userAgent: "Tape fixture" }, { cookies: async () => [] } as unknown as BrowserContext, out, config);
    assert.equal(await nonempty(out), true);
    assert.deepEqual(await fs.readdir(path.dirname(out)), ["audio.mp3"]);
  } finally {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
