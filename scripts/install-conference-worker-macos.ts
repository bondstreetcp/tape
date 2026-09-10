/** Install a per-user LaunchAgent. No sudo or public listening port. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
async function main() {
  if (process.platform !== "darwin") throw new Error("Run this installer on the Mac that will own the queue.");
  const root = process.cwd();
  await fs.access(path.join(root, ".conference-runner/config.json"));
  const label = "com.bondstreetcp.tape-conferences";
  const logs = path.join(root, ".conference-runner");
  const agents = path.join(homedir(), "Library/LaunchAgents");
  await fs.mkdir(agents, { recursive: true });
  const plist = path.join(agents, `${label}.plist`);
  // Refuse to replace an existing service or change another checkout's worker.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>/usr/bin/caffeinate</string><string>-i</string><string>${escape(process.execPath)}</string><string>--import</string><string>tsx</string><string>scripts/conference-worker.ts</string><string>run</string></array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(path.dirname(process.execPath))}:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${escape(path.join(logs, "worker.log"))}</string>
<key>StandardErrorPath</key><string>${escape(path.join(logs, "worker-errors.log"))}</string>
</dict></plist>`;
  await fs.writeFile(plist, xml, { flag: "wx", mode: 0o600 });
  execFileSync("/usr/bin/plutil", ["-lint", plist], { stdio: "inherit" });
  execFileSync("/bin/launchctl", ["bootstrap", `gui/${process.getuid!()}`, plist], { stdio: "inherit" });
  console.log(`Installed ${label}. It runs while this Mac user is logged in and prevents idle sleep. Queue URLs with npm run conference:queue -- URL.`);
}
main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
