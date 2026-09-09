#!/usr/bin/env node
// ============================================================================
//  Tape — CAPTURE SERVER. A tiny, zero-dependency HTTP listener you run on the
//  machine you browse conferences from. The companion bookmarklet (see
//  docs/conference-capture-SOP.md) POSTs the ONE talk you clicked; this server
//  downloads that single talk's audio right then, while its signed token is
//  fresh, into AUDIO_DIR/TICKER_DATE.mp3 — ready for
//  `barclays-transcribe.sh --audio-dir`.
//
//  It does NOT log in, navigate, or crawl the portal. It only downloads a URL a
//  human explicitly captured by opening a talk they're entitled to view — the
//  same thing `webcast-dl.sh` does by hand, minus the copy-paste and the
//  token-expiry race. One click = one authorized download.
//
//  Run it:
//    node scripts/capture-server.mjs
//  then load a talk in the player, click the bookmarklet, pick the ticker.
//
//  Config (env):
//    CAPTURE_PORT  listen port on 127.0.0.1        (default 8765)
//    AUDIO_DIR     where mp3s land                 (default ~/communicopia-audio)
//    YTDLP         yt-dlp binary                    (default yt-dlp / yt-dlp.exe on PATH)
//    REFERER       sent to the CDN (704 without it) (default https://event.webcasts.com/)
//    UA            user-agent                       (default Mozilla/5.0)
//    ALLOW_ORIGIN  origins allowed to POST          (default https://event.webcasts.com)
//                  comma-separated; "*" to allow any (loopback-bound, so still local-only)
//    CAPTURE_TOKEN optional shared secret; if set, the bookmarklet must send it
// ============================================================================
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.CAPTURE_PORT || 8765);
const AUDIO_DIR = process.env.AUDIO_DIR || path.join(os.homedir(), 'communicopia-audio');
const YTDLP = process.env.YTDLP || 'yt-dlp';
const REFERER = process.env.REFERER || 'https://event.webcasts.com/';
const UA = process.env.UA || 'Mozilla/5.0';
const TOKEN = process.env.CAPTURE_TOKEN || '';
const ALLOW = (process.env.ALLOW_ORIGIN || 'https://event.webcasts.com')
  .split(',').map((s) => s.trim()).filter(Boolean);

mkdirSync(AUDIO_DIR, { recursive: true });

// Only accept the securehds webcast CDN — never a URL the page could smuggle to
// point yt-dlp somewhere else. Tighten/loosen HOST_OK if your streams differ.
const HOST_OK = /^https:\/\/[a-z0-9.-]*\bwebcasts\.com\//i;
const TICKER_OK = /^[A-Z0-9.\-]{1,12}$/;
const DATE_OK = /^\d{4}-\d{2}-\d{2}$/;

let inflight = 0;
let done = 0;
let failed = 0;

function originAllowed(origin) {
  if (ALLOW.includes('*')) return true;
  return origin && ALLOW.includes(origin);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': originAllowed(origin) ? (origin || '*') : ALLOW[0] || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Tape-Token',
    'Vary': 'Origin',
  };
}

function download({ ticker, url, date }) {
  const out = path.join(AUDIO_DIR, `${ticker}_${date}.mp3`);
  const args = [
    '--referer', REFERER,
    '--user-agent', UA,
    '-x', '--audio-format', 'mp3',
    '--no-playlist',
    '-o', out,
    url,
  ];
  inflight += 1;
  const started = Date.now();
  console.log(`[capture] START ${ticker} ${date} -> ${out}`);
  const child = spawn(YTDLP, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d.toString(); });
  child.on('error', (e) => {
    inflight -= 1; failed += 1;
    console.error(`[capture] SPAWN-FAIL ${ticker}: ${e.message} (is yt-dlp on PATH? set YTDLP=)`);
  });
  child.on('close', (code) => {
    inflight -= 1;
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    if (code === 0) {
      done += 1;
      console.log(`[capture] OK    ${ticker} (${secs}s)  [done ${done}, failed ${failed}, inflight ${inflight}]`);
    } else {
      failed += 1;
      const hint = /HTTP Error 704|403|token/i.test(err)
        ? '  (token likely expired — re-open the talk and click again)' : '';
      console.error(`[capture] FAIL  ${ticker} rc=${code}${hint}`);
      if (err) console.error(err.split('\n').slice(-4).join('\n'));
    }
  });
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || '';
  const cors = corsHeaders(origin);

  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain', ...cors });
    res.end(`tape capture server\nAUDIO_DIR=${AUDIO_DIR}\ndone=${done} failed=${failed} inflight=${inflight}\n`);
    return;
  }

  if (req.method !== 'POST' || req.url !== '/capture') {
    res.writeHead(404, cors); res.end('not found'); return;
  }

  if (!originAllowed(origin)) {
    console.warn(`[capture] rejected origin: ${origin || '(none)'}`);
    res.writeHead(403, { 'Content-Type': 'application/json', ...cors });
    res.end(JSON.stringify({ ok: false, error: 'origin not allowed' }));
    return;
  }

  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on('end', () => {
    let p;
    try { p = JSON.parse(body); } catch { p = null; }
    const reply = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json', ...cors });
      res.end(JSON.stringify(obj));
    };
    if (!p) return reply(400, { ok: false, error: 'bad json' });
    if (TOKEN && (req.headers['x-tape-token'] || '') !== TOKEN)
      return reply(401, { ok: false, error: 'bad token' });

    const ticker = String(p.ticker || '').trim().toUpperCase();
    const date = String(p.date || '').trim();
    const url = String(p.url || '').trim();
    if (!TICKER_OK.test(ticker)) return reply(400, { ok: false, error: 'bad ticker' });
    if (!DATE_OK.test(date)) return reply(400, { ok: false, error: 'bad date' });
    if (!HOST_OK.test(url)) return reply(400, { ok: false, error: 'url not a webcasts.com stream' });

    download({ ticker, url, date });
    reply(200, { ok: true, ticker, date, queued: true });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`tape capture server on http://127.0.0.1:${PORT}`);
  console.log(`  audio -> ${AUDIO_DIR}`);
  console.log(`  allowed origins: ${ALLOW.join(', ')}${TOKEN ? '  (token required)' : ''}`);
  console.log('  open a talk, press Play, click the bookmarklet. Ctrl-C to stop.');
});
