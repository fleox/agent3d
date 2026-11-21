import { statSync, watch, type FSWatcher } from "node:fs";
import { relative, sep } from "node:path";

// Watches a project folder (fs.watch recursive) and reports changed
// project-relative paths, debounced. renders/, dist/, .git and
// node_modules are ignored. Paths the caller just wrote itself can be
// muted (`ignoreNext`) so API writes don't echo back as external changes.

export interface ProjectWatcher {
  close(): void;
  ignoreNext(path: string): void;
}

const IGNORED = /^(renders|dist|node_modules|\.git)(\/|$)|(^|\/)\.DS_Store$|~$|\.swp$/;

export function watchProject(root: string, onChange: (paths: string[]) => void, debounceMs = 120): ProjectWatcher {
  const pending = new Set<string>();
  const muted = new Map<string, number>();
  let timer: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;
  const flush = () => {
    timer = null;
    const now = Date.now();
    const paths = [...pending].filter((p) => !((muted.get(p) ?? 0) > now) && !isDir(`${root}/${p}`));
    pending.clear();
    if (paths.length) onChange(paths.sort());
  };
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = (typeof filename === "string" ? filename : String(filename)).split(sep).join("/");
      if (IGNORED.test(rel) || rel.startsWith("..") || relative(root, `${root}/${rel}`).startsWith("..")) return;
      pending.add(rel);
      if (!timer) timer = setTimeout(flush, debounceMs);
    });
    watcher.on("error", () => undefined);
  } catch {
    watcher = null;
  }
  return {
    close() {
      if (timer) clearTimeout(timer);
      watcher?.close();
    },
    ignoreNext(path: string) {
      muted.set(path, Date.now() + 1000);
    },
  };
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
