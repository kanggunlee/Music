import test from "node:test";
import assert from "node:assert/strict";
import { nextDecision, moveItem, shuffled } from "../dist/queue.js";
const base = {
  queue: ["b", "c"],
  current: "a",
  library: ["a", "b", "c"],
  repeat: "off",
  shuffle: false,
  autoplay: true,
};
test("sequential playback consumes queue without mutating input", () => {
  assert.deepEqual(nextDecision(base, true), {
    id: "b",
    queue: ["c"],
    restart: false,
  });
  assert.deepEqual(base.queue, ["b", "c"]);
});
test("repeat one restarts the current track only on end", () => {
  assert.equal(nextDecision({ ...base, repeat: "one" }, true).id, "a");
  assert.equal(nextDecision({ ...base, repeat: "one" }, false).id, "b");
});
test("autoplay off stops on end but manual next still advances", () => {
  assert.equal(nextDecision({ ...base, autoplay: false }, true), null);
  assert.equal(nextDecision({ ...base, autoplay: false }, false).id, "b");
});
test("end of normal queue stops rather than implicitly looping", () =>
  assert.equal(nextDecision({ ...base, queue: [] }, true), null));
test("repeat all rebuilds queue at its end", () =>
  assert.deepEqual(
    nextDecision({ ...base, current: "c", queue: [], repeat: "all" }, true),
    { id: "a", queue: ["b", "c"], restart: false },
  ));
test("shuffle preserves every track and avoids immediate repeat across cycles", () => {
  const out = nextDecision(
    { ...base, queue: [], shuffle: true, repeat: "all" },
    true,
    () => 0.99,
  );
  assert.notEqual(out.id, "a");
  assert.deepEqual([out.id, ...out.queue].sort(), ["a", "b", "c"]);
  assert.deepEqual(shuffled(["a"]), ["a"]);
});
test("queue reordering handles duplicates and invalid indices", () => {
  assert.deepEqual(moveItem(["a", "b", "a"], 2, 0), ["a", "a", "b"]);
  assert.deepEqual(moveItem(["a", "b"], 0, 9), ["a", "b"]);
});
test("empty library never starts repeat loop", () =>
  assert.equal(
    nextDecision(
      { ...base, current: null, queue: [], library: [], repeat: "all" },
      true,
    ),
    null,
  ));
