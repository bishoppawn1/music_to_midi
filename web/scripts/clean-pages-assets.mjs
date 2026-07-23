import { rm } from "node:fs/promises";
import { basename, resolve } from "node:path";

const assetDirectory = resolve(import.meta.dirname, "../../site-assets");

if (basename(assetDirectory) !== "site-assets") {
  throw new Error(`Refusing to clean unexpected directory: ${assetDirectory}`);
}

await rm(assetDirectory, { recursive: true, force: true });
