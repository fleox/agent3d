// Tiny safe expression evaluator for HUD `visible` conditions and text
// placeholders — NO eval / Function. Grammar:
//   expr   := or
//   or     := and ("||" and)*
//   and    := unary ("&&" unary)*
//   unary  := "!" unary | cmp
//   cmp    := value (("=="|"!="|"==="|"!=="|">"|"<"|">="|"<=") value)?
//   value  := number | 'string' | "string" | true | false | null | path | "(" expr ")"
//   path   := ident ("." ident)*      ("state." prefix optional)

type Tok = { t: "num"; v: number } | { t: "str"; v: string } | { t: "id"; v: string } | { t: "op"; v: string };

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(src[i + 1] ?? "") && (out.length === 0 || out[out.length - 1].t === "op"))) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push({ t: "num", v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== ch) {
        if (src[j] === "\\" && j + 1 < src.length) j++;
        s += src[j++];
      }
      if (j >= src.length) throw new Error("Unterminated string");
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_$.]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    if (three === "===" || three === "!==") { out.push({ t: "op", v: three.slice(0, 2) }); i += 3; continue; }
    if (["==", "!=", ">=", "<=", "&&", "||"].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("!<>()".includes(ch)) { out.push({ t: "op", v: ch }); i++; continue; }
    throw new Error(`Unexpected "${ch}"`);
  }
  return out;
}

const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);

export function lookup(state: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  if (parts[0] === "state") parts.shift();
  let cur: unknown = state;
  for (const p of parts) {
    if (FORBIDDEN.has(p)) return undefined;
    if (cur === null || typeof cur !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function evaluate(src: string, state: Record<string, unknown>): unknown {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;

  function value(): unknown {
    const tk = toks[pos++];
    if (!tk) throw new Error("Unexpected end");
    if (tk.t === "num" || tk.t === "str") return tk.v;
    if (tk.t === "id") {
      if (tk.v === "true") return true;
      if (tk.v === "false") return false;
      if (tk.v === "null" || tk.v === "undefined") return null;
      return lookup(state, tk.v);
    }
    if (tk.v === "(") {
      const v = or();
      if (!isOp(")")) throw new Error("Missing )");
      pos++;
      return v;
    }
    throw new Error(`Unexpected "${tk.v}"`);
  }
  function cmp(): unknown {
    const left = value();
    const tk = peek();
    if (tk?.t === "op" && ["==", "!=", ">", "<", ">=", "<="].includes(tk.v)) {
      pos++;
      const right = value();
      const l = left as number, r = right as number;
      switch (tk.v) {
        case "==": return left == right || (left == null && right == null);
        case "!=": return !(left == right);
        case ">": return l > r;
        case "<": return l < r;
        case ">=": return l >= r;
        default: return l <= r;
      }
    }
    return left;
  }
  function unary(): unknown {
    if (isOp("!")) {
      pos++;
      return !unary();
    }
    return cmp();
  }
  function and(): unknown {
    let v = unary();
    while (isOp("&&")) {
      pos++;
      const r = unary();
      v = v && r;
    }
    return v;
  }
  function or(): unknown {
    let v = and();
    while (isOp("||")) {
      pos++;
      const r = and();
      v = v || r;
    }
    return v;
  }
  const result = or();
  if (pos < toks.length) throw new Error(`Unexpected "${(toks[pos] as { v: unknown }).v}"`);
  return result;
}

// HUD `visible`: boolean, a state key ("showHelp"), or an expression.
export function isVisible(v: boolean | string | undefined, state: Record<string, unknown>): boolean {
  if (v === undefined) return true;
  if (typeof v === "boolean") return v;
  try {
    return !!evaluate(v, state);
  } catch {
    return false;
  }
}

// "Score: {score}" / "{state.lives} ♥" → text with values from state.
export function formatText(text: string, state: Record<string, unknown>): string {
  return text.replace(/\{([^{}]+)\}/g, (_, key: string) => {
    const k = key.trim();
    let v: unknown;
    try {
      v = /^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(k) ? lookup(state, k) : evaluate(k, state);
    } catch {
      v = undefined;
    }
    if (v === undefined || v === null) return "";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
    return String(v);
  });
}
