import type { ImageCodec, ImageCodecInput, ImageCodecOutput } from "../../src/ops/optimize";
import { CliError } from "../output";
import { launchBrowser, requireBrowser, type LaunchedBrowser } from "./browser";
import { CdpClient, type CdpSession } from "./cdp";

// The ImageCodec of `assets optimize`: decode / downscale / re-encode in
// headless Chrome (createImageBitmap + OffscreenCanvas.convertToBlob), the
// same browser the renders use. One browser for the whole run.

const PAGE_FN = `async function (b64, mime, maxSize, quality, allowJpeg) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime }), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const s = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, 0, 0, w, h);
  let type = mime;
  if (mime === "image/png" && allowJpeg) {
    const d = g.getImageData(0, 0, w, h).data;
    let opaque = true;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { opaque = false; break; }
    if (opaque) type = "image/jpeg";
  }
  const blob = await canvas.convertToBlob(type === "image/png" ? { type } : { type, quality: quality / 100 });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let out = "";
  for (let i = 0; i < buf.length; i += 0x8000) out += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { b64: btoa(out), mimeType: blob.type, width: w, height: h, srcWidth: bmp.width, srcHeight: bmp.height };
}`;

export interface ChromeImageCodec {
  codec: ImageCodec;
  close(): Promise<void>;
}

export async function openImageCodec(opts: { log?: (m: string) => void } = {}): Promise<ChromeImageCodec> {
  const info = requireBrowser();
  let browser: LaunchedBrowser | null = null;
  let client: CdpClient | null = null;
  const close = async () => {
    try {
      client?.close();
    } catch {
      /* ignore */
    }
    await browser?.close().catch(() => undefined);
  };
  let page: CdpSession;
  let windowId: string;
  try {
    opts.log?.(`[agent3d assets] ${info.name}: ${info.path}`);
    browser = await launchBrowser(info);
    client = await CdpClient.connect(browser.wsUrl);
    page = await client.newPage();
    windowId = (await page.send<{ result: { objectId: string } }>("Runtime.evaluate", { expression: "window" })).result.objectId;
  } catch (e) {
    await close();
    throw e;
  }
  const codec: ImageCodec = async (input: ImageCodecInput): Promise<ImageCodecOutput> => {
    const r = await page.send<{ result: { value?: { b64: string; mimeType: string; width: number; height: number; srcWidth: number; srcHeight: number } }; exceptionDetails?: { exception?: { description?: string }; text?: string } }>(
      "Runtime.callFunctionOn",
      {
        functionDeclaration: PAGE_FN,
        objectId: windowId,
        arguments: [{ value: Buffer.from(input.bytes).toString("base64") }, { value: input.mimeType }, { value: input.maxSize }, { value: input.quality }, { value: input.allowJpeg }],
        awaitPromise: true,
        returnByValue: true,
      },
      120_000,
    );
    if (r.exceptionDetails || !r.result.value)
      throw new CliError("image-decode", `Could not decode this ${input.mimeType} image: ${(r.exceptionDetails?.exception?.description ?? r.exceptionDetails?.text ?? "no result").split("\n")[0]}`, "The file may be corrupt or in an unsupported format.");
    const v = r.result.value;
    return { bytes: new Uint8Array(Buffer.from(v.b64, "base64")), mimeType: v.mimeType, width: v.width, height: v.height, srcWidth: v.srcWidth, srcHeight: v.srcHeight };
  };
  return { codec, close };
}

// Runs `fn` with a codec, always closing the browser.
export async function withImageCodec<T>(fn: (codec: ImageCodec) => Promise<T>, opts: { log?: (m: string) => void } = {}): Promise<T> {
  const c = await openImageCodec(opts);
  try {
    return await fn(c.codec);
  } finally {
    await c.close();
  }
}
