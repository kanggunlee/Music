/** Playlist references never duplicate media blobs. */
export function makePlaylist(name, trackIds = []) {
  const title = String(name).trim().slice(0, 80);
  if (!title) throw new Error("Give your playlist a name.");
  return {
    id: crypto.randomUUID(),
    name: title,
    trackIds: [...new Set(trackIds)],
    created: Date.now(),
  };
}
export function addToPlaylist(playlist, ids) {
  return {
    ...playlist,
    trackIds: [...new Set([...playlist.trackIds, ...ids])],
  };
}
export function prunePlaylists(playlists, removedIds) {
  const removed = new Set(removedIds);
  return playlists.map((p) => ({
    ...p,
    trackIds: p.trackIds.filter((id) => !removed.has(id)),
  }));
}
