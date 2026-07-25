/**
 * Move a freshly-extracted tree into place one atomic rename at a time.
 *
 * WHY THIS EXISTS: the NAS now hydrates the LIVE slot's data/ without restarting the server
 * (scripts/nas/tape-web-entrypoint.sh), so `tar -xzf` extracting straight over data/ writes each feed
 * underneath concurrent readers. A request landing mid-write reads a truncated file — and that is not
 * a momentary blemish, because Next's ISR pins the resulting empty render for the whole revalidate
 * period. ~10s of half-written file becomes ~10 min of an empty board, once an hour.
 *
 * rename(2) is atomic within a filesystem: a reader holding the path sees either the complete old file
 * or the complete new one, never a mixture. So we extract to a staging directory beside the target and
 * rename each file in. The window doesn't shrink — it stops existing.
 *
 * ⚠ SAME FILESYSTEM. If `stage` and `destRoot` land on different mounts, rename() fails with EXDEV and
 * the fallback everyone reaches for (copy-then-unlink) reintroduces exactly the window this removes.
 * Callers must stage inside the same slot they are hydrating.
 */
import { readdirSync, mkdirSync, renameSync, rmSync } from "fs";
import path from "path";

/**
 * Rename every file under `stage` into the matching path under `destRoot`, creating directories as
 * needed. Returns the number of files moved.
 *
 * Files present in `destRoot` but absent from `stage` are LEFT ALONE — same as `tar -x`, which
 * overlays rather than mirrors. That matters: the per-stock company cache ships as a separate tarball
 * into the same tree, and a mirroring promote would delete whichever half landed first.
 */
export function promoteTree(stage: string, destRoot: string): number {
  let moved = 0;
  const walk = (rel: string) => {
    for (const entry of readdirSync(path.join(stage, rel), { withFileTypes: true })) {
      const childRel = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        mkdirSync(path.join(destRoot, childRel), { recursive: true });
        walk(childRel);
      } else if (entry.isFile()) {
        renameSync(path.join(stage, childRel), path.join(destRoot, childRel));
        moved++;
      }
      // Symlinks/devices are not produced by our own tarballs; skipping them is deliberate.
    }
  };
  for (const top of readdirSync(stage, { withFileTypes: true })) {
    if (!top.isDirectory()) continue;
    mkdirSync(path.join(destRoot, top.name), { recursive: true });
    walk(top.name);
  }
  return moved;
}

/** Extract `tarPath` into `stage`, promote it into `destRoot` atomically, then clear the staging dir. */
export function extractAtomic(
  tarPath: string,
  stage: string,
  destRoot: string,
  untar: (tarPath: string, into: string) => void,
): number {
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  untar(tarPath, stage);
  const moved = promoteTree(stage, destRoot);
  rmSync(stage, { recursive: true, force: true });
  return moved;
}
