/** Explicit opt-in browser integration test. Every request is intercepted; never hits a real conference. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConferenceBrowser } from "../scripts/conference-browser";

test("dated agenda + nested player captures the selected talk's fresh response on each attempt", async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "tape-conf-browser-"));
  const browser = await ConferenceBrowser.open({ profile, channel: process.platform === "win32" ? "msedge" : "chrome", headless: true, loginTimeoutMs: 5000, streamTimeoutMs: 5000 });
  let tokens = 0;
  try {
    await browser.context.route("**/*", async route => {
      const url = new URL(route.request().url());
      let body: string;
      if (url.pathname === "/viewer/agenda.jsp") body = `<!doctype html><title>Fixture Consumer Conference - 1769358</title>
        <a href="#" onclick="changeday('9/8/2026')">Tuesday</a>
        <a href="#" onclick="changeday('9/9/2026')">Wednesday</a>
        <div id="date"></div><div id="talks"></div><iframe id="popup" style="display:none"></iframe>
        <script>
          function changeday(d) {
            document.querySelector('#date').textContent = d === '9/8/2026' ? 'Tuesday, September 08, 2026' : 'Wednesday, September 09, 2026';
            const id = d === '9/8/2026' ? '1773017' : '1773002';
            const name = d === '9/8/2026' ? 'Freshpet' : 'Constellation Brands, Inc.';
            const a = document.createElement('a'); a.href='#'; a.textContent=name;
            a.setAttribute('onclick', "showSpeaker('https://event.webcasts.com/starthere.jsp?ei=" + id + "&tp_key=fixture','');");
            document.querySelector('#talks').replaceChildren(a);
          }
          function showSpeaker(url) { const f = document.querySelector('#popup'); f.style.display='block'; f.src='/viewer/launch.jsp?ei='+new URL(url).searchParams.get('ei'); }
          changeday('9/8/2026');
        </script>`;
      else if (url.pathname === "/viewer/launch.jsp") body = `<a href="#" aria-label="Close Player Button" onclick="parent.document.querySelector('#popup').style.display='none';document.querySelector('#media').src='about:blank'">Close</a><iframe id="media" src="/viewer/event.jsp?ei=${url.searchParams.get("ei")}"></iframe>`;
      else if (url.pathname === "/viewer/event.jsp") {
        tokens++;
        body = `<video id="playerVdo"></video><script>fetch('https://od.cdn.webcasts.com/conf001/999999/playlist.m3u8?t=stale');fetch('https://od.cdn.webcasts.com/conf001/${url.searchParams.get("ei")}/playlist.m3u8?t=fresh-${tokens}')</script>`;
      } else if (url.pathname.endsWith(".m3u8")) {
        await route.fulfill({ status: 200, contentType: "application/vnd.apple.mpegurl", headers: { "Access-Control-Allow-Origin": "*" }, body: "#EXTM3U\n#EXT-X-ENDLIST\n" });
        return;
      } else { await route.abort(); return; }
      await route.fulfill({ status: 200, contentType: "text/html", body });
    });
    const result = await browser.discover("https://event.webcasts.com/viewer/agenda.jsp?ei=1769358&tp_key=fixture");
    assert.equal(result.talks.length, 2);
    assert.equal(result.talks[0].date, "2026-09-08");
    assert.equal(result.talks[1].date, "2026-09-09");
    const captured: string[] = [];
    await browser.capture(result.talks[0], async stream => { captured.push(stream.url); });
    await browser.capture(result.talks[0], async stream => { captured.push(stream.url); });
    assert.equal(captured.length, 2);
    assert.ok(captured.every(url => url.includes("/1773017/")));
    assert.notEqual(captured[0], captured[1], "each reopening must mint a fresh URL");
  } finally {
    await browser.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});
