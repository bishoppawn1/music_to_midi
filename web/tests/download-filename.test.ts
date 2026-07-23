import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDownloadTimestamp,
  makeDownloadFilename,
  safeFileStem,
} from "../app/download-filename.ts";

test("formats the user's local date and time without filename-unsafe punctuation", () => {
  const localTime = new Date(2026, 6, 23, 2, 5, 9);

  assert.equal(formatDownloadTimestamp(localTime), "2026-07-23_02-05-09");
  assert.equal(
    makeDownloadFilename("YouTube Capture", localTime),
    "youtube-capture-2026-07-23_02-05-09.mid",
  );
});

test("keeps the reverse marker before the timestamp", () => {
  const localTime = new Date(2026, 10, 4, 17, 30, 45);

  assert.equal(
    makeDownloadFilename("YouTube Capture Reverse", localTime),
    "youtube-capture-reverse-2026-11-04_17-30-45.mid",
  );
});

test("normalizes unsafe titles and falls back for an empty title", () => {
  assert.equal(safeFileStem("  Piano: take / 2?  "), "piano-take-2");
  assert.equal(safeFileStem("///"), "transcription");
});
