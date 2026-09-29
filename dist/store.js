import { prunePlaylists } from "./playlists.js";
/** All user data stays in this origin's IndexedDB. Blobs are separate so listing
 * a large library doesn't read every MP4 into memory. */
let opening;
export function openDB() {
  if (!opening)
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open("pocket-media", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("tracks", { keyPath: "id" });
        db.createObjectStore("media");
        db.createObjectStore("state");
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        opening = null;
        reject(request.error);
      };
      request.onblocked = () => {
        opening = null;
        reject(new Error("Close other Pocket tabs and try again."));
      };
    });
  return opening;
}
async function transaction(stores, mode, run) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error || new Error("Storage operation was cancelled."));
    try {
      run(tx, (value) => {
        result = value;
      });
    } catch (e) {
      tx.abort();
      reject(e);
    }
  });
}
export const listTracks = () =>
  transaction(["tracks"], "readonly", (tx, done) => {
    tx.objectStore("tracks").getAll().onsuccess = (e) => done(e.target.result);
  });
export const getMedia = (id) =>
  transaction(["media"], "readonly", (tx, done) => {
    tx.objectStore("media").get(id).onsuccess = (e) => done(e.target.result);
  });
export const addTrack = (track, blob) =>
  transaction(["tracks", "media"], "readwrite", (tx) => {
    tx.objectStore("tracks").put(track);
    tx.objectStore("media").put(blob, track.id);
  });
export const updateTrack = (track) =>
  transaction(["tracks"], "readwrite", (tx) =>
    tx.objectStore("tracks").put(track),
  );
export const deleteTracks = (ids) =>
  transaction(["tracks", "media", "state"], "readwrite", (tx) => {
    for (const id of ids) {
      tx.objectStore("tracks").delete(id);
      tx.objectStore("media").delete(id);
    }
    const state = tx.objectStore("state");
    state.get("playlists").onsuccess = (e) =>
      state.put(prunePlaylists(e.target.result || [], ids), "playlists");
  });
export const clearLibrary = () =>
  transaction(["tracks", "media", "state"], "readwrite", (tx) => {
    tx.objectStore("tracks").clear();
    tx.objectStore("media").clear();
    const state = tx.objectStore("state");
    state.get("playlists").onsuccess = (e) =>
      state.put(
        (e.target.result || []).map((p) => ({ ...p, trackIds: [] })),
        "playlists",
      );
  });
export const readState = () =>
  transaction(["state"], "readonly", (tx, done) => {
    tx.objectStore("state").get("player").onsuccess = (e) =>
      done(e.target.result);
  });
export const writeState = (state) =>
  transaction(["state"], "readwrite", (tx) =>
    tx.objectStore("state").put(state, "player"),
  );
export function storageError(error) {
  return error?.name === "QuotaExceededError"
    ? "This device is out of browser storage. Remove some tracks or free space, then try again."
    : `Could not save on this device. ${error?.message || "Check browser storage settings and try again."}`;
}

export const readPlaylists = () =>
  transaction(["state"], "readonly", (tx, done) => {
    tx.objectStore("state").get("playlists").onsuccess = (e) =>
      done(e.target.result || []);
  });
export const writePlaylists = (playlists) =>
  transaction(["state"], "readwrite", (tx) =>
    tx.objectStore("state").put(playlists, "playlists"),
  );
