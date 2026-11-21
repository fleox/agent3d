// Script sandbox lint (CLAUDE.md rule 7). Scripts only get `api`; this scan
// rejects the globals that would escape the sandbox. It blanks out strings,
// template literal text and comments first (keeping `${…}` expressions), so
// `"use fetch"` in a string or a comment is not flagged; property accesses
// like `obj.parent` or `api.top` and object keys `{ top: 1 }` are not flagged.

import type { Issue } from "../core/types";

// Identifier → why it is forbidden.
const FORBIDDEN: Record<string, string> = {
  fetch: "network access",
  XMLHttpRequest: "network access",
  WebSocket: "network access",
  EventSource: "network access",
  eval: "dynamic code execution",
  Function: "dynamic code execution",
  document: "DOM access outside the HUD",
  window: "global page access",
  globalThis: "global page access",
  self: "global page access",
  localStorage: "storage (use api.storage)",
  sessionStorage: "storage (use api.storage)",
  indexedDB: "storage (use api.storage)",
  parent: "access to the parent page",
  top: "access to the top page",
  opener: "access to the opener page",
  postMessage: "cross-frame messaging",
  importScripts: "loading remote code",
  navigator: "device / network APIs",
  location: "page navigation",
  Worker: "spawning code",
};

// Words that are only flagged when used like the global (followed by . ( [ ).
const AMBIGUOUS = new Set(["parent", "top", "self", "location", "opener"]);

export function stripCode(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  // Stack of template-literal brace depths.
  const tpl: number[] = [];
  let braceDepth = 0;
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  let prevSignificant = "";
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      out += blank(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out += blank(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out += c + blank(src.slice(i + 1, j)) + (j < n ? src[j] : "");
      i = j + 1;
      prevSignificant = c;
      continue;
    }
    if (c === "`" || (c === "}" && tpl.length && tpl[tpl.length - 1] === braceDepth)) {
      // Template text until ` or ${
      if (c === "}") {
        tpl.pop();
      }
      let j = i + 1;
      let opened = false;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === "`") break;
        if (src[j] === "$" && src[j + 1] === "{") {
          opened = true;
          break;
        }
        j++;
      }
      out += c + blank(src.slice(i + 1, j));
      if (opened) {
        out += "${";
        tpl.push(braceDepth);
        i = j + 2;
      } else {
        out += j < n ? "`" : "";
        i = j + 1;
      }
      prevSignificant = "`";
      continue;
    }
    // Regex literal (heuristic: "/" after an operator or at start).
    if (c === "/" && /^$|[(,=:[!&|?{};+\-*%<>~^]$/.test(prevSignificant)) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) break;
        j++;
      }
      if (j < n && src[j] === "/") {
        out += "/" + blank(src.slice(i + 1, j)) + "/";
        i = j + 1;
        prevSignificant = "/x";
        continue;
      }
    }
    if (c === "{") braceDepth++;
    if (c === "}") braceDepth--;
    out += c;
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return out;
}

function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

export function lintScript(source: string, path: string): Issue[] {
  const issues: Issue[] = [];
  const code = stripCode(source);
  const declared = new Set<string>();
  for (const m of code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);

  const re = /[A-Za-z_$][\w$]*/g;
  for (const m of code.matchAll(re)) {
    const word = m[0];
    const idx = m.index ?? 0;
    if (word === "import") {
      const after = code.slice(idx + 6).trimStart();
      const before = code.slice(0, idx).trimEnd();
      if (before.endsWith(".")) continue; // import.meta handled below
      if (after.startsWith("(")) {
        issues.push(issue(path, lineOf(source, idx), "Dynamic import() is forbidden in scripts.", "Scripts cannot load code: everything they need comes from the `api` argument."));
      } else if (after.startsWith(".meta")) {
        issues.push(issue(path, lineOf(source, idx), "import.meta is forbidden in scripts.", "Use api.data for configuration."));
      } else if (/^[\w${*]/.test(after) || after.startsWith('"') || after.startsWith("'")) {
        issues.push(issue(path, lineOf(source, idx), "Static imports are not allowed in scripts.", "Scripts are self-contained modules: remove the import and use the `api` passed to the default export."));
      }
      continue;
    }
    const why = FORBIDDEN[word];
    if (!why) continue;
    const after = code.slice(idx + word.length).trimStart();
    const prevChar = code.slice(Math.max(0, idx - 200), idx).trimEnd().slice(-1);
    if (prevChar === ".") continue; // property access obj.top, obj?.top
    if (after.startsWith("(") && /^\s*\)\s*\{/.test(code.slice(idx + word.length).replace(/^\s*\([^)]*/, ""))) {
      // method shorthand `parent() {` in an object literal: a definition, not a call
      if (prevChar === "{" || prevChar === "," || prevChar === "}") continue;
    }
    if (after.startsWith(":") && (prevChar === "{" || prevChar === ",")) continue; // object key { top: 1 }
    if (AMBIGUOUS.has(word) && declared.has(word)) continue; // local variable named like the global
    if (AMBIGUOUS.has(word) && !/^[.([]/.test(after)) continue;
    issues.push(issue(path, lineOf(source, idx), `Forbidden global "${word}" (${why}).`, hintFor(word)));
  }
  if (/\bdocument\s*\.\s*cookie\b|\.cookie\b/.test(code) && !issues.some((i) => i.message.includes("document"))) {
    const idx = code.search(/\.cookie\b/);
    issues.push(issue(path, lineOf(source, idx), "Cookie access is forbidden in scripts.", "Use api.storage.get/set for small persistent values."));
  }
  if (!/\bexport\s+default\b/.test(code)) {
    issues.push({ severity: "error", code: "forbidden-script", path, message: "The script has no `export default` factory.", hint: "Write `export default function (api) { return { start() {}, update(dt, t) {} }; }`." });
  }
  return dedupe(issues);
}

function hintFor(word: string): string {
  if (["fetch", "XMLHttpRequest", "WebSocket", "EventSource"].includes(word)) return "Scenes never call the network at run time. Put data in scene.data (api.data) or in project assets.";
  if (["localStorage", "sessionStorage", "indexedDB"].includes(word)) return "Use api.storage.get(key) / api.storage.set(key, value).";
  if (word === "document" || word === "window" || word === "globalThis" || word === "self") return "Use the api: api.ui.set(id, { text }) for the HUD, api.input for keys/pointer, api.state for shared values.";
  if (word === "eval" || word === "Function") return "Write the logic directly; dynamic code is not allowed.";
  return "Remove it — scripts only get the `api` argument (see ScriptApi).";
}

function issue(path: string, line: number, message: string, hint: string): Issue {
  return { severity: "error", code: "forbidden-script", path: `${path}:${line}`, message, hint };
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.path}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
