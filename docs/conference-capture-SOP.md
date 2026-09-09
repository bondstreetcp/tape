# Conference capture SOP — one click per talk

Turns a sell-side conference webcast (Barclays, Goldman Communicopia, etc. on
webcasts.com) into transcribed + summarized notes in tape, with **one click per
talk and no terminal/DevTools**. Designed to hand to a VA/intern.

**What a human does:** open each talk in the player (you're entitled to view it),
press Play, click the bookmarklet, confirm the ticker. That's it.
**What's automated:** download → transcribe → summarize → publish.

The one manual touch is unavoidable: each talk mints a fresh, short-lived signed
token only when its player loads — there's no "download all" endpoint. This SOP
makes that touch a single click and downloads instantly so tokens never expire.

---

## One-time setup (5 min)

Do this on the machine you'll **browse the conference from** (the box needs
`yt-dlp` + `node`).

1. **Install yt-dlp** if missing:
   - Windows: `winget install yt-dlp.yt-dlp`
   - macOS: `brew install yt-dlp`
2. **Start the capture server** from the tape checkout:
   ```bash
   node scripts/capture-server.mjs
   ```
   It prints `tape capture server on http://127.0.0.1:8765` and where audio lands
   (default `~/communicopia-audio`). Leave it running while you capture.
   - To put audio elsewhere: `AUDIO_DIR=/path/to/folder node scripts/capture-server.mjs`
   - To require a shared secret: `CAPTURE_TOKEN=somestring node scripts/capture-server.mjs`
     (then set the same value in the bookmarklet's `T=` below).
3. **Add the bookmarklet.** Make a new bookmark, name it **"Grab talk → tape"**,
   and paste this as the URL:

   ```
   javascript:(function(){var S='http://127.0.0.1:8765/capture',T='',K='__tapeCapCount';function g(){try{return JSON.parse(localStorage.getItem(K)||'[]')}catch(e){return[]}}function s(a){try{localStorage.setItem(K,JSON.stringify(a))}catch(e){}}function b(){var el=document.getElementById('__tapeBadge');if(!el){el=document.createElement('div');el.id='__tapeBadge';el.style.cssText='position:fixed;z-index:2147483647;right:14px;bottom:14px;background:#111;color:#fff;font:13px/1.35 system-ui,sans-serif;padding:9px 12px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.45);white-space:nowrap';document.body.appendChild(el)}var a=g(),last=a.length?' (last '+a[a.length-1]+')':'';el.innerHTML='tape captured: <b>'+a.length+'</b>'+last+' <span id="__tapeReset" style="cursor:pointer;opacity:.6;margin-left:6px">reset</span>';var x=document.getElementById('__tapeReset');if(x)x.onclick=function(){if(confirm('Reset captured counter?')){s([]);b()}}}var r=performance.getEntriesByType('resource').map(function(e){return e.name}),p=r.filter(function(u){return u.indexOf('.m3u8')>-1&&u.indexOf('playlist')>-1});if(!p.length)p=r.filter(function(u){return u.indexOf('.m3u8')>-1});var u=p.length?p[p.length-1]:'';if(!u){alert('No stream URL yet - press Play so the player loads, then click again.');return}var c=(document.title||'').replace(/\s+/g,' ').trim();var t=prompt('Ticker for:\n'+c,'');if(t===null)return;t=t.trim().toUpperCase();var d=prompt('Date (YYYY-MM-DD):',new Date().toISOString().slice(0,10));if(d===null)return;d=d.trim();var h={'Content-Type':'text/plain'};if(T)h['X-Tape-Token']=T;fetch(S,{method:'POST',headers:h,body:JSON.stringify({ticker:t,url:u,date:d,company:c})}).then(function(x){return x.json()}).then(function(j){if(j&&j.ok){var a=g();a.push(j.ticker||t);s(a);b()}else{alert('Rejected: '+((j&&j.error)||'unknown'))}}).catch(function(){alert('Cannot reach capture server on 127.0.0.1:8765 - start it on THIS machine: node scripts/capture-server.mjs')});b()})();
   ```

   If you started the server with `CAPTURE_TOKEN=...`, edit the bookmarklet's
   `T=''` to `T='somestring'`.

---

## Per talk (the loop the VA runs)

1. Open the talk in the webcasts player and press **Play** (a few seconds so the
   stream loads).
2. Click the **"Grab talk → tape"** bookmark.
3. Type the **ticker** (the company name is shown), confirm the **date**.
4. A **"tape captured: N (last TICKER)"** badge in the bottom-right ticks up on
   success — no OK to dismiss. Move to the next talk. The count persists as you
   navigate between talks; "reset" zeroes it (e.g. at the start of a new
   conference). Only errors pop an alert.

The capture server also logs each one (`[capture] OK STZ (18s)` …). If a talk
says the token expired, just re-open it and click again — the badge won't tick
until the download is accepted.

---

## After the conference: transcribe + summarize (one command each)

Audio now sits in `~/communicopia-audio` as `TICKER_DATE.mp3`.

**On the capture box** (has whisper.cpp) — transcribe everything, idempotent:
```bash
WHISPER_MODEL=~/whisper-models/ggml-large-v3-turbo.bin \
  sh scripts/barclays-transcribe.sh --capture-only --audio-dir ~/communicopia-audio
```
(Set `CONF='Barclays Consumer 2026'` — or the right conference label — first.)

This writes transcript drops to `data/incoming-transcripts/`. Copy them to the
NAS and ingest (the NAS reaches the digest rig; the mini can't):
```bash
scp data/incoming-transcripts/*.json argus-nas:~/tape-ops/repo/data/incoming-transcripts/
ssh argus-nas 'cd ~/tape-ops/repo && GIT_CONFIG_NOSYSTEM=1 npm run ingest-transcript-text'
```

The nightly ingest digests them into summaries; `sync-calls-archive` publishes.

---

## Scaling to many conferences a month

- **The pipeline is volume-blind.** 5 talks or 500, the only human step is the
  one-click capture — everything after is unattended.
- **Delegate the clicking.** This SOP is a clean VA task: legitimate access, no
  judgment calls, one click + one ticker per talk. Point them at steps 1–4.
- **Batch the download-to-publish** across conferences by pointing `--audio-dir`
  at each conference's folder (name folders per event; set `CONF=` to match).

## What this does NOT do (by design)

It never logs in, navigates, or crawls the agenda. It downloads only the single
talk a human explicitly opened and clicked — the same authorized action as
`webcast-dl.sh`, minus the copy-paste. No auto-looping over the catalog.
