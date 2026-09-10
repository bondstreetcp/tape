import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
const xml = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
async function main() {
  if (process.platform !== "darwin") throw Error("Install this service on the Mac.");
  await fs.access(".conference-runner/portal.json");
  const root = process.cwd(), label = "com.bondstreetcp.tape-conference-portal";
  const file = path.join(homedir(), "Library/LaunchAgents", `${label}.plist`);
  const args = [process.execPath, "--import", "tsx", "scripts/conference-portal-bridge.ts"];
  await fs.writeFile(file, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map(a=>`<string>${xml(a)}</string>`).join("")}</array><key>WorkingDirectory</key><string>${xml(root)}</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path.dirname(process.execPath))}:/opt/homebrew/bin:/usr/bin:/bin</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>StandardOutPath</key><string>${xml(root)}/.conference-runner/portal.log</string><key>StandardErrorPath</key><string>${xml(root)}/.conference-runner/portal-errors.log</string></dict></plist>`, { flag: "wx", mode: 0o600 });
  execFileSync("/usr/bin/plutil", ["-lint", file], { stdio: "inherit" });
  execFileSync("/bin/launchctl", ["bootstrap", `gui/${process.getuid!()}`, file], { stdio: "inherit" });
}
main().catch(e => { console.error((e as Error).message); process.exitCode = 1; });
