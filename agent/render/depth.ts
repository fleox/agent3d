import { createReadStream, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DEPTH_MODEL, ensureDepthModel, type DepthEstimator, type DepthEstimatorInput, type DepthEstimatorOutput, type ModelCache } from "../../src/ops/depth";
import type { FetchLike } from "../../src/ops/sources";
import { CliError } from "../output";
import { ORT_FILES, ortDir } from "../paths";
import { launchBrowser, requireBrowser, type LaunchedBrowser } from "./browser";
import { CdpClient, type CdpSession } from "./cdp";
import { mimeOf, startLocalServer, type LocalServer } from "./server";

// The DepthEstimator of `assets depth` / `image_depth`: Depth Anything V2
// Small (ONNX) run by onnxruntime-web (WASM, multi-threaded) in headless
// Chrome — the browser the renders already use, no native dependency. The
// model is downloaded once into the user's model cache (~/.agent3d/models,
// AGENT3D_MODELS overrides). A 127.0.0.1 server sends the page, the ORT files
// and the model with COOP / COEP headers (crossOriginIsolated → WASM threads).

export function modelsDir(): string {
  return process.env.AGENT3D_MODELS ? resolve(process.env.AGENT3D_MODELS) : join(homedir(), ".agent3d", "models");
}

export function nodeModelCache(root = modelsDir()): ModelCache {
  const abs = (rel: string) => join(root, ...rel.split("/"));
  const atomic = (rel: string, data: Uint8Array | string) => {
    const file = abs(rel);
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, data);
    renameSync(tmp, file);
  };
  return {
    location: abs,
    async size(rel) {
      try {
        const s = statSync(abs(rel));
        return s.isFile() ? s.size : null;
      } catch {
        return null;
      }
    },
    async write(rel, bytes) {
      atomic(rel, bytes);
    },
    async writeText(rel, text) {
      atomic(rel, text);
    },
  };
}

const PAGE = (threads: number) => `<!doctype html><meta charset="utf-8"><title>agent3d depth</title>
<script type="module">
window.__depth = { ready: false, error: null };
try {
  const ort = await import("/ort/ort.wasm.bundle.min.mjs");
  ort.env.wasm.wasmPaths = { wasm: "/ort/ort-wasm-simd-threaded.wasm" };
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(${threads}, navigator.hardwareConcurrency || 1)) : 1;
  ort.env.logLevel = "error";
  const session = await ort.InferenceSession.create("/model/model.onnx", { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  window.__depthRun = async (b64, mime, W, H, mean, std) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const canvas = new OffscreenCanvas(W, H);
    const g = canvas.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.fillStyle = "#808080";
    g.fillRect(0, 0, W, H);
    g.drawImage(bmp, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data;
    const n = W * H;
    const input = new Float32Array(3 * n);
    for (let i = 0; i < n; i++)
      for (let c = 0; c < 3; c++) input[c * n + i] = (px[i * 4 + c] / 255 - mean[c]) / std[c];
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, H, W]) });
    const t = out[session.outputNames[0]];
    const dims = t.dims;
    const data = t.data instanceof Float32Array ? t.data : Float32Array.from(t.data);
    const buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { b64: btoa(s), width: dims[dims.length - 1], height: dims[dims.length - 2], srcWidth: bmp.width, srcHeight: bmp.height };
  };
  window.__depth = { ready: true, error: null, threads: ort.env.wasm.numThreads, isolated: self.crossOriginIsolated };
} catch (e) {
  window.__depth = { ready: false, error: String((e && e.stack) || e) };
}
</script>`;

const ISOLATION_HEADERS = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "cross-origin-resource-policy": "same-origin",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function sendIsolated(res: ServerResponse, file: string, method?: string): true {
  if (!existsSync(file)) return void res.writeHead(404, ISOLATION_HEADERS).end("Not found"), true;
  res.writeHead(200, { ...ISOLATION_HEADERS, "content-type": mimeOf(file), "content-length": String(statSync(file).size) });
  if (method === "HEAD") res.end();
  else createReadStream(file).on("error", () => res.destroy()).pipe(res);
  return true;
}

export interface ChromeDepthEstimator {
  estimator: DepthEstimator;
  backend: string;
  model: { path: string; downloaded: boolean };
  close(): Promise<void>;
}

export interface DepthEstimatorOptions {
  log?: (m: string) => void;
  fetch?: FetchLike; // model download (default: global fetch)
  cache?: ModelCache;
  threads?: number; // default 4
}

export async function openDepthEstimator(opts: DepthEstimatorOptions = {}): Promise<ChromeDepthEstimator> {
  const ort = ortDir();
  if (!ort)
    throw new CliError("depth-runtime-missing", `onnxruntime-web is missing (${ORT_FILES.join(", ")} not found next to the CLI).`, "Reinstall @fleox/agent3d (the files ship in dist/agent/ort/); in a clone run `npm install` then `npm run build:agent`.");
  const info = requireBrowser();
  const model = await ensureDepthModel(opts.cache ?? nodeModelCache(), opts.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined), { log: opts.log });
  let server: LocalServer | null = null;
  let browser: LaunchedBrowser | null = null;
  let client: CdpClient | null = null;
  const close = async () => {
    try {
      client?.close();
    } catch {
      /* ignore */
    }
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  };
  let page: CdpSession;
  let backend = "wasm";
  try {
    const html = PAGE(opts.threads ?? 4);
    server = await startLocalServer({
      mounts: {},
      routes: [
        (req, res, url) => {
          if (url.pathname === "/" || url.pathname === "/depth.html") return void res.writeHead(200, { ...ISOLATION_HEADERS, "content-type": "text/html; charset=utf-8" }).end(html), true;
          if (url.pathname === "/model/model.onnx") return sendIsolated(res, model.path, req.method);
          const m = /^\/ort\/([\w.-]+)$/.exec(url.pathname);
          if (m && (ORT_FILES as readonly string[]).includes(m[1])) return sendIsolated(res, join(ort, m[1]), req.method);
          return false;
        },
      ],
    });
    opts.log?.(`[agent3d depth] ${info.name}: ${info.path}`);
    browser = await launchBrowser(info);
    client = await CdpClient.connect(browser.wsUrl);
    page = await client.newPage();
    await page.send("Runtime.enable");
    await page.send("Page.enable");
    await page.send("Page.navigate", { url: `${server.url}/depth.html` });
    const deadline = Date.now() + 120_000;
    type PageState = { ready: boolean; error: string | null; threads?: number; isolated?: boolean } | null;
    let state = null as PageState;
    for (;;) {
      state = await page.evaluate<PageState>("window.__depth ?? null", 10_000).catch(() => null);
      if (state?.ready || state?.error || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!state?.ready)
      throw new CliError(
        "depth-failed",
        `The depth model could not start in headless ${info.name}: ${(state?.error ?? "timed out after 120 s").split("\n")[0]}`,
        `The cached model may be corrupt: delete ${model.dir} to download it again. Otherwise update the browser or point AGENT3D_CHROME at Google Chrome; you can also provide a depth map by hand (grey PNG, white = near).`,
        1,
        { error: state?.error ?? null },
      );
    backend = `wasm (${state.threads ?? 1} thread${(state.threads ?? 1) > 1 ? "s" : ""})`;
  } catch (e) {
    await close();
    throw e;
  }
  const estimator: DepthEstimator = async (input: DepthEstimatorInput): Promise<DepthEstimatorOutput> => {
    const r = await page.send<{ result: { value?: { b64: string; width: number; height: number; srcWidth: number; srcHeight: number } }; exceptionDetails?: { exception?: { description?: string }; text?: string } }>(
      "Runtime.evaluate",
      {
        expression: `window.__depthRun(${JSON.stringify(Buffer.from(input.bytes).toString("base64"))}, ${JSON.stringify(input.mimeType)}, ${input.width}, ${input.height}, ${JSON.stringify(DEPTH_MODEL.mean)}, ${JSON.stringify(DEPTH_MODEL.std)})`,
        awaitPromise: true,
        returnByValue: true,
      },
      180_000,
    );
    if (r.exceptionDetails || !r.result.value)
      throw new CliError("image-decode", `Depth estimation failed for this ${input.mimeType} image: ${(r.exceptionDetails?.exception?.description ?? r.exceptionDetails?.text ?? "no result").split("\n")[0]}`, "The file may be corrupt or in an unsupported format (use .jpg, .png or .webp).");
    const v = r.result.value;
    const buf = Buffer.from(v.b64, "base64");
    const depth = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    return { depth, width: v.width, height: v.height, srcWidth: v.srcWidth, srcHeight: v.srcHeight, backend };
  };
  return { estimator, backend, model: { path: model.path, downloaded: model.downloaded }, close };
}

// Runs `fn` with a depth estimator, always closing the browser.
export async function withDepthEstimator<T>(fn: (estimator: DepthEstimator) => Promise<T>, opts: DepthEstimatorOptions = {}): Promise<T> {
  const e = await openDepthEstimator(opts);
  try {
    return await fn(e.estimator);
  } finally {
    await e.close();
  }
}
