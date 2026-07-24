import assert from "node:assert/strict";
import test from "node:test";
import {
  activateSensitivityVersion,
  sensitivityVersionUrls,
  type SensitivityVersions,
} from "../app/sensitivity-versions.ts";

test("activating a sensitivity version keeps shared capture settings", () => {
  const variants: SensitivityVersions<{
    notes: number[];
    midiUrl: string;
  }> = {
    more: { notes: [1, 2, 3], midiUrl: "blob:more" },
    balanced: { notes: [1, 2], midiUrl: "blob:balanced" },
    clean: { notes: [1], midiUrl: "blob:clean" },
  };
  const result = {
    title: "One capture",
    pitchRange: "full",
    direction: "reverse",
    activeSensitivity: "balanced" as const,
    variants,
    ...variants.balanced,
  };

  const cleaner = activateSensitivityVersion(result, "clean");

  assert.deepEqual(cleaner.notes, [1]);
  assert.equal(cleaner.midiUrl, "blob:clean");
  assert.equal(cleaner.activeSensitivity, "clean");
  assert.equal(cleaner.title, "One capture");
  assert.equal(cleaner.pitchRange, "full");
  assert.equal(cleaner.direction, "reverse");
});

test("version URL cleanup returns each object URL once", () => {
  assert.deepEqual(
    sensitivityVersionUrls({
      more: { midiUrl: "blob:shared" },
      balanced: { midiUrl: "blob:balanced" },
      clean: { midiUrl: "blob:shared" },
    }),
    ["blob:shared", "blob:balanced"],
  );
});
