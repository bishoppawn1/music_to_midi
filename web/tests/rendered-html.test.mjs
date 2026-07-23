import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";


async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

const environment = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

test("server-renders the finished conversion product", async () => {
  const response = await (await worker()).fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    environment,
    context,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Link to MIDI/);
  assert.match(html, /Paste the link/);
  assert.match(html, /Make MIDI/);
  assert.match(html, /og:image/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);
});

test("rejects non-YouTube source URLs before making a network request", async () => {
  const response = await (await worker()).fetch(
    new Request("http://localhost/api/audio?url=https%3A%2F%2Fexample.com%2Fvideo", {
      headers: { origin: "https://bishoppawn1.github.io" },
    }),
    environment,
    context,
  );
  assert.equal(response.status, 400);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://bishoppawn1.github.io",
  );
  assert.deepEqual(await response.json(), { error: "Paste a valid YouTube video link." });
});

test("allows the GitHub Pages application to call the audio bridge", async () => {
  const response = await (await worker()).fetch(
    new Request("http://localhost/api/audio", {
      method: "OPTIONS",
      headers: { origin: "https://bishoppawn1.github.io" },
    }),
    environment,
    context,
  );

  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://bishoppawn1.github.io",
  );
  assert.match(response.headers.get("access-control-allow-methods") ?? "", /\bGET\b/);
});

test("ships the transcription model and no starter preview", async () => {
  await Promise.all([
    access(new URL("../public/model/model.json", import.meta.url)),
    access(new URL("../public/model/group1-shard1of1.bin", import.meta.url)),
    access(new URL("../public/og.png", import.meta.url)),
  ]);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));

  const [page, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /@spotify\/basic-pitch/);
  assert.match(page, /cleanRetriggers/);
  assert.match(packageJson, /"youtubei\.js"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
