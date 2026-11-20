import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
const svg = await readFile(path.join(publicRoot, "brand/logo.svg"), "utf8");
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const sizes = [
  ["brand/favicon-16.png", 16],
  ["brand/favicon-32.png", 32],
  ["brand/favicon.png", 64],
  ["favicon.png", 32],
  ["apple-touch-icon.png", 180],
  ["apple-touch-icon-precomposed.png", 180],
  ["brand/icon.png", 1024],
  ["brand/icon-192.png", 192],
  ["brand/icon-512.png", 512],
  ["brand/icon-1024.png", 1024],
];

const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage({viewport: {width: 1024, height: 1024}});
  await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;object-fit:contain}</style><img src="${dataUrl}">`);
  const image = page.locator("img");
  for (const [file, size] of sizes) {
    await page.setViewportSize({width: size, height: size});
    await image.evaluate((element, dimension) => {
      element.style.width = `${dimension}px`;
      element.style.height = `${dimension}px`;
    }, size);
    await image.screenshot({path: path.join(publicRoot, file), omitBackground: true});
  }
} finally {
  await browser.close();
}
