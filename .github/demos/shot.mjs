// Screenshot of a page in headless Chrome after a real-time wait (the scene
// in an exported index.html needs its intro to play; --virtual-time-budget
// does not advance WebGL animation reliably). Node >= 22 (global WebSocket).
//   node .github/demos/shot.mjs <chrome> <url> <out.png> [width] [height] [waitMs]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [chrome, url, out, width = "1440", height = "810", wait = "6000"] = process.argv.slice(2);
const profile = mkdtempSync(join(tmpdir(), "a3d-demo-shot-"));
const proc = spawn(chrome, [
  "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  `--window-size=${width},${height}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  proc.stderr.on("data", (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\S+)/);
    if (m) resolve(m[1]);
  });
  proc.once("exit", () => reject(new Error("Chrome exited")));
});

const browser = new WebSocket(wsUrl);
await new Promise((r) => browser.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
browser.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    browser.send(JSON.stringify({ id: n, method, params, sessionId }));
  });

const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Emulation.setDeviceMetricsOverride", {
  width: Number(width), height: Number(height), deviceScaleFactor: 1, mobile: false,
}, sessionId);
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] }, sessionId);
await send("Page.enable", {}, sessionId);
await send("Page.navigate", { url }, sessionId);
await new Promise((r) => setTimeout(r, Number(wait)));
const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
browser.close();
const exited = new Promise((r) => proc.once("exit", r));
proc.kill();
await exited;
rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
