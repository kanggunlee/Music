import test from "node:test";
import assert from "node:assert/strict";
import {
  makePlaylist,
  addToPlaylist,
  prunePlaylists,
} from "../dist/playlists.js";
import { moveItem, nextDecision } from "../dist/queue.js";
test("playlist name validation and duplicate prevention", () => {
  assert.throws(() => makePlaylist("   "));
  const p = makePlaylist(" Night drive ", ["a", "b", "a"]);
  assert.equal(p.name, "Night drive");
  assert.deepEqual(p.trackIds, ["a", "b"]);
  assert.ok(p.id);
});
test("adding tracks preserves chosen order and does not duplicate existing tracks", () => {
  const p = makePlaylist("Mix", ["b", "a"]);
  const updated = addToPlaylist(p, ["a", "c", "c"]);
  assert.deepEqual(updated.trackIds, ["b", "a", "c"]);
  assert.deepEqual(p.trackIds, ["b", "a"]);
});
test("deleting media prunes all playlist references, preserving empty playlists", () => {
  const lists = [makePlaylist("One", ["a", "b"]), makePlaylist("Two", ["a"])];
  const clean = prunePlaylists(lists, ["a"]);
  assert.deepEqual(
    clean.map((p) => p.trackIds),
    [["b"], []],
  );
  assert.equal(clean[1].name, "Two");
  assert.deepEqual(lists[0].trackIds, ["a", "b"]);
});
test("playlist reorder and repeat operate only on the selected collection", () => {
  const ids = moveItem(["a", "c"], 1, 0);
  assert.deepEqual(ids, ["c", "a"]);
  const decision = nextDecision(
    {
      current: "a",
      queue: [],
      library: ids,
      repeat: "all",
      shuffle: false,
      autoplay: true,
    },
    true,
  );
  assert.deepEqual(decision, { id: "c", queue: ["a"], restart: false });
});
