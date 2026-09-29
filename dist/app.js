import { makePlaylist, addToPlaylist } from "./playlists.js";
import { moveItem } from "./queue.js";
import * as db from "./store.js";
import { inspectFile } from "./metadata.js";
import { Player, presets, frequencies } from "./player.js";
const $ = (s) => document.querySelector(s);
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  library: "M4 4v16M9 4v16M14 4l5 16",
  play: "m8 5 11 7-11 7z",
  pause: "M8 5v14M16 5v14",
  next: "m5 5 10 7-10 7zM19 5v14",
  previous: "m19 5-10 7 10 7zM5 5v14",
  queue: "M4 6h16M4 12h12M4 18h8m6-3 4 3-4 3",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  plus: "M12 5v14M5 12h14",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  music: "M9 18V5l11-2v13M9 18c0 3-6 4-6 1s6-4 6-1m11-2c0 3-6 4-6 1s6-4 6-1",
  shield: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6zM8 12l3 3 5-6",
  shuffle: "M3 5h3l12 14h3M3 19h3L18 5h3m-3-3 3 3-3 3m0 8 3 3-3 3",
  repeat:
    "m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-3v5a2 2 0 0 1-2 2H3",
  volume: "M4 9h4l5-4v14l-5-4H4zM16 8q5 4 0 8m3-11q7 7 0 14",
  mute: "M4 9h4l5-4v14l-5-4H4zM17 9l5 6m0-6-5 6",
  back: "M4 10a8 8 0 1 1 1 8M4 4v6h6",
  forward: "M20 10a8 8 0 1 0-1 8m1-14v6h-6",
  up: "m6 15 6-6 6 6",
  down: "m6 9 6 6 6-6",
  close: "m6 6 12 12M6 18 18 6",
  trash: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  rename: "m4 16 12-12 4 4L8 20H4z",
  headphones: "M4 13v-1a8 8 0 0 1 16 0v1M4 12h3v8H4zm13 0h3v8h-3z",
  device: "M7 2h10v20H7zM10 18h4",
  check: "m5 12 4 4L19 6",
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.music}"/></svg>`;
}
function button(action, label, name, cls = "", attrs = "") {
  return `<button class="icon-button ${cls}" data-action="${action}" aria-label="${escape(label)}" title="${escape(label)}" ${attrs}>${icon(name)}</button>`;
}
const time = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const bytes = (n) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(1)} MB`;
let playlists = [],
  libraryTab = "tracks",
  openedPlaylist = null;
let tracks = [],
  player,
  route = "library",
  sort = "recent",
  selecting = false,
  selected = new Set(),
  importing = false,
  importMessage = "",
  storage = null,
  persisted = false,
  storageAvailable = true,
  noticeTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => $("#toast").classList.remove("visible"), 6500);
}
function art(track, extra = "") {
  return track?.cover
    ? `<img class="art ${extra}" src="${escape(track.cover)}" alt="" loading="lazy">`
    : `<div class="art placeholder ${extra}" style="--hue:${track ? Array.from(track.id).reduce((n, c) => n + c.charCodeAt(0), 0) % 360 : 90}" aria-hidden="true">${icon("music")}</div>`;
}
function ordered() {
  return [...tracks].sort(
    sort === "title"
      ? (a, b) => a.title.localeCompare(b.title)
      : sort === "duration"
        ? (a, b) => b.duration - a.duration
        : (a, b) => b.added - a.added,
  );
}
function top() {
  return `<div class="topline"><a class="brand mobile-brand" href="#library"><span class="brand-mark">p</span> pocket<span class="brand-dot">•</span></a><p class="eyebrow">A LITTLE SPACE FOR YOUR SOUND</p><span class="device-badge">${icon("shield")} On this device</span></div>`;
}
function navigation() {
  const tabs = [
    ["library", "Library", "library"],
    ["playing", "Now Playing", "headphones"],
    ["queue", "Queue", "queue"],
    ["settings", "Settings", "settings"],
  ];
  for (const target of ["desktop-nav", "mobile-nav"])
    $("#" + target).innerHTML = tabs
      .map(
        ([key, label, img]) =>
          `<button data-route="${key}" class="${route === key ? "active" : ""}" ${route === key ? 'aria-current="page"' : ""}>${icon(img)}<span>${label}</span></button>`,
      )
      .join("");
}
function empty(title, copy, cta = true) {
  return `<section class="empty">${icon("music")}<h2>${title}</h2><p>${copy}</p>${cta ? `<button class="primary" data-action="add">${icon("plus")} Add files</button><small>MP3 and MP4 files · Saved only on this device</small>` : ""}</section>`;
}
function library() {
  if (libraryTab === "playlists") return playlistView();
  const list = ordered();
  return `${top()}<header class="page-header"><div><h1>Your library</h1><p>${tracks.length ? `${tracks.length} track${tracks.length === 1 ? "" : "s"} · ${Math.round(tracks.reduce((n, t) => n + t.duration, 0) / 60)} minutes of your own` : "Your favorites. Always within reach."}</p></div><button class="primary" data-action="add" ${!storageAvailable || importing ? "disabled" : ""}>${icon("plus")} Add files</button></header>${libraryTabs()}${!tracks.length ? `<section class="intro-panel"><div><p class="eyebrow">OFFLINE. ON YOUR TERMS.</p><h2>Make yourself at home.</h2><p>Bring your MP3s and MP4s. We’ll take care of the listening.</p><button class="primary" data-action="add" ${!storageAvailable || importing ? "disabled" : ""}>${icon("plus")} Add your first tracks</button></div><div class="disc" aria-hidden="true"></div></section>` : `<div class="selection-bar"><button class="primary" data-action="play-all">${icon("play")} Play all</button><button class="secondary" data-action="shuffle-all">${icon("shuffle")} Shuffle</button></div>`}${importMessage ? `<div class="import-status" role="status">${escape(importMessage)}</div>` : ""}${!storageAvailable ? `<div class="panel"><h2>Storage is unavailable</h2><p>Allow website storage in your browser, then reload. Pocket won’t import files it can’t keep safely.</p><button class="secondary" data-action="reload">Try again</button></div>` : ""}<div class="library-tools"><h2>All tracks <span class="count">${tracks.length}</span></h2>${tracks.length ? `<button class="text-button" data-action="select">${selecting ? "Done" : "Select"}</button><select class="select" id="sort" aria-label="Sort library"><option value="recent" ${sort === "recent" ? "selected" : ""}>Recently added</option><option value="title" ${sort === "title" ? "selected" : ""}>Title A–Z</option><option value="duration" ${sort === "duration" ? "selected" : ""}>Longest first</option></select>` : ""}</div>${selecting ? `<div class="selection-bar"><span>${selected.size} selected</span><button class="secondary" data-action="select-all">Select all</button><button class="secondary" data-action="queue-selected" ${!selected.size ? "disabled" : ""}>Queue</button><button class="secondary" data-action="playlist-selected" ${!selected.size ? "disabled" : ""}>Add to playlist</button><button class="secondary danger" data-action="delete-selected" ${!selected.size ? "disabled" : ""}>Delete</button></div>` : ""}${list.length ? `<div class="track-header"><span>TRACK</span><span>TIME</span></div><div>${list.map((t, i) => `<article class="track ${player.state.current === t.id ? "current" : ""}">${selecting ? `<input class="track-check" type="checkbox" aria-label="Select ${escape(t.title)}" data-select="${t.id}" ${selected.has(t.id) ? "checked" : ""}>` : `<button class="track-number" data-action="track" data-id="${t.id}" aria-label="Play ${escape(t.title)}">${player.state.current === t.id && !player.audio.paused ? icon("volume") : String(i + 1).padStart(2, "0")}</button>`}${art(t)}<div><button class="track-title" style="max-width:100%;min-height:24px;padding:0;text-align:left" data-action="track" data-id="${t.id}">${escape(t.title)}</button><div class="track-meta">${escape(t.artist || t.format || "Local audio")} · ${time(t.duration)}</div></div><span class="duration">${time(t.duration)}</span>${button("options", `Options for ${t.title}`, "more", "", 'data-id="' + t.id + '"')}</article>`).join("")}</div>` : empty("A good library starts with one track.", "Choose MP3s and MP4s from Files, or drop them here. No syncing, no subscriptions, just play.", false)}<div class="library-foot">${icon("shield")} ${bytes(tracks.reduce((n, t) => n + t.size, 0))} stored locally · Your files never leave this device</div>`;
}
function playing() {
  const t = player.track;
  if (!t)
    return `${top()}<header class="page-header"><h1>Now playing</h1></header><div class="no-track">${empty("Find your next favorite moment.", "Choose a track from your library, or bring something new.")}<button class="text-button" data-route="library">Go to library →</button></div>`;
  const s = player.state;
  return `${top()}<header class="page-header"><div><p class="eyebrow">FROM YOUR LIBRARY</p><h1>Now playing</h1></div>${button("options", "Track options", "more", "", 'data-id="' + t.id + '"')}</header><section class="player-layout"><div class="cover-wrap">${art(t)}</div><div class="player-copy"><h2>${escape(t.title)}</h2><p>${escape(t.artist || t.format || "Local audio")} · ${bytes(t.size)}</p><div class="progress-block"><input id="seek" type="range" min="0" max="${t.duration}" step="0.1" value="${player.audio.currentTime || s.position}" aria-label="Playback position"><div class="time-row"><span id="elapsed">${time(player.audio.currentTime || s.position)}</span><span id="remaining">−${time(t.duration - (player.audio.currentTime || s.position))}</span></div></div><div class="transport">${button("shuffle", s.shuffle ? "Turn shuffle off" : "Turn shuffle on", "shuffle", s.shuffle ? "is-on" : "", `aria-pressed="${s.shuffle}"`)}${button("previous", "Previous track", "previous")}<button class="play-round" data-action="toggle" aria-label="${player.audio.paused ? "Play" : "Pause"}">${icon(player.audio.paused ? "play" : "pause")}</button>${button("next", "Next track", "next")}${button("repeat", `Repeat: ${s.repeat}`, "repeat", s.repeat !== "off" ? "is-on" : "", `aria-pressed="${s.repeat !== "off"}"`)}${s.repeat === "one" ? '<span class="subtle">1</span>' : ""}</div><div class="extra-controls"><button class="subtle" data-action="back">${icon("back")} 10s</button><button class="subtle" data-action="speed">${s.speed}×</button><button class="subtle" data-action="forward">10s ${icon("forward")}</button></div><div class="volume">${button("mute", s.muted ? "Unmute" : "Mute", s.muted ? "mute" : "volume")}<input id="volume" type="range" min="0" max="1" step=".01" value="${s.volume}" aria-label="Volume"></div><p class="notice">On iPhone, use your device’s volume buttons.</p><div class="player-footer"><button class="text-button" data-route="settings">${icon("settings")} ${s.eqEnabled ? s.eqPreset : "Equalizer off"}</button><button class="text-button" data-route="queue">${icon("queue")} Up next (${s.queue.length})</button></div></div></section>`;
}
function queue() {
  const s = player.state;
  return `${top()}<header class="page-header"><div><h1>Your queue</h1><p>${s.queue.length} track${s.queue.length === 1 ? "" : "s"} coming up</p></div><button class="secondary" data-action="clear-queue" ${s.queue.length ? "" : "disabled"}>Clear queue</button></header>${player.track ? `<p class="eyebrow">NOW PLAYING</p><article class="track queue-track current">${art(player.track)}<div><div class="track-title">${escape(player.track.title)}</div><div class="track-meta">${escape(player.track.artist || player.track.format || "Local audio")}</div></div><div class="queue-actions">${button("toggle", player.audio.paused ? "Play" : "Pause", player.audio.paused ? "play" : "pause")}</div></article><p class="eyebrow" style="margin-top:32px">UP NEXT</p>` : ""}${
    s.queue.length
      ? s.queue
          .map((id, i) => {
            const t = tracks.find((x) => x.id === id);
            if (!t) return "";
            return `<article class="track queue-track">${art(t)}<div><div class="track-title">${escape(t.title)}</div><div class="track-meta">${time(t.duration)} · ${escape(t.artist || t.format || "Local audio")}</div></div><div class="queue-actions">${button("queue-play", `Play ${t.title}`, "play", "", `data-index="${i}"`)}${button("queue-next", "Move to play next", "queue", "", `data-index="${i}" ${i === 0 ? "disabled" : ""}`)}${button("queue-up", "Move up", "up", "", `data-index="${i}" ${i === 0 ? "disabled" : ""}`)}${button("queue-down", "Move down", "down", "", `data-index="${i}" ${i === s.queue.length - 1 ? "disabled" : ""}`)}${button("queue-remove", `Remove ${t.title} from queue`, "close", "", `data-index="${i}"`)}</div></article>`;
          })
          .join("")
      : empty(
          "A little room for what’s next.",
          "Use a track’s options to add it to the queue or play it next.",
          false,
        )
  }<p class="notice" style="margin-top:24px">Use the arrows to change the order. Removing a track here keeps it in your library.</p>`;
}
function selectSetting(id, label, values, current) {
  return `<div class="setting-row"><label for="${id}">${label}</label><select class="select" id="${id}">${values.map(([v, l]) => `<option value="${v}" ${String(current) === String(v) ? "selected" : ""}>${l}</option>`).join("")}</select></div>`;
}
function settings() {
  const s = player.state;
  return `${top()}<header class="page-header"><div><h1>Make it yours</h1><p>A few small things. A better listen.</p></div></header><div class="settings-grid"><section class="panel"><h2>Listening</h2>${selectSetting(
    "repeat-setting",
    "Repeat",
    [
      ["off", "Off"],
      ["all", "All tracks"],
      ["one", "One track"],
    ],
    s.repeat,
  )}${selectSetting(
    "speed-setting",
    "Playback speed",
    [
      [0.75, "0.75×"],
      [1, "Normal"],
      [1.25, "1.25×"],
      [1.5, "1.5×"],
      [2, "2×"],
    ],
    s.speed,
  )}<div class="setting-row"><label for="autoplay">Keep listening<small>Play the next track automatically</small></label><input class="toggle" type="checkbox" id="autoplay" ${s.autoplay ? "checked" : ""}></div>${selectSetting(
    "theme",
    "Appearance",
    [
      ["dark", "Dark"],
      ["light", "Light"],
    ],
    s.theme,
  )}</section><section class="panel"><h2>On this device</h2><p>${tracks.length} tracks · ${bytes(tracks.reduce((n, t) => n + t.size, 0))}</p><div class="storage-meter"><span style="width:${storage?.quota ? (100 * storage.usage) / storage.quota : 0}%"></span></div><p class="notice">${storage?.quota ? `${bytes(storage.usage)} used of ${bytes(storage.quota)} browser allowance.` : "Storage allowance is not available in this browser."}<br>${persisted ? "Persistent storage granted." : "Storage may be reclaimed by your browser."} Keep your original files.</p><button class="text-button" data-action="persist">Request persistent storage</button><div class="setting-row"><label>Start fresh<small>Delete all media from this browser</small></label><button class="text-button danger" data-action="clear-library" ${tracks.length ? "" : "disabled"}>Clear library</button></div></section><section class="panel wide"><div class="setting-row" style="padding-top:0"><label for="eq-enabled"><h2 style="margin-bottom:4px">Shape your sound</h2><small>Five-band equalizer</small></label><input class="toggle" type="checkbox" id="eq-enabled" ${s.eqEnabled ? "checked" : ""}></div>${selectSetting(
    "preset",
    "Preset",
    [...Object.keys(presets), "Custom"].map((x) => [x, x]),
    s.eqPreset,
  )}<div class="eq-bands">${frequencies.map((f, i) => `<div class="eq-band"><output id="gain-${i}">${s.bands[i] > 0 ? "+" : ""}${s.bands[i]} dB</output><input type="range" min="-12" max="12" step="1" value="${s.bands[i]}" data-band="${i}" aria-label="${f} Hz gain" ${s.eqEnabled ? "" : "disabled"}><span>${f >= 1000 ? f / 1000 + "k" : f} Hz</span></div>`).join("")}</div><p class="notice" style="margin:25px 0 0">The equalizer changes the audio using Web Audio. On iPhone, it may interrupt playback when the screen locks. Turn it off for the most reliable background listening.</p></section><section class="panel wide"><h2>Pocket, on your Home Screen.</h2><p>Open this link in Safari, tap Share, then Add to Home Screen. Open Pocket once online to save the interface for offline use.</p><button class="secondary" data-action="install">${icon("device")} Installation guide</button><p class="notice" style="margin:20px 0 0">A tap is required to start audio. Lock-screen controls and background playback depend on your browser and iOS version. If playback stops, reopen Pocket and tap Play. Libraries are local to this browser and site address; import your files in the Home Screen app you plan to use.</p></section></div>`;
}
function render() {
  if (!player) return;
  document.body.classList.toggle("light", player.state.theme === "light");
  $('meta[name="theme-color"]').content =
    player.state.theme === "light" ? "#f5f7f0" : "#101311";
  navigation();
  $("#main").innerHTML = (
    { library, playing, queue, settings }[route] || library
  )();
  renderMini();
}
function renderMini() {
  const t = player.track;
  $("#mini").innerHTML =
    !t || route === "playing"
      ? ""
      : `<section class="mini" aria-label="Mini player"><button class="mini-info" data-route="playing">${art(t)}<div class="copy"><div class="track-title">${escape(t.title)}</div><div class="track-meta">${escape(t.artist || t.format || "Local audio")}</div></div></button><div class="mini-controls">${button("previous", "Previous track", "previous", "previous")}<button class="play-round" data-action="toggle" aria-label="${player.audio.paused ? "Play" : "Pause"}">${icon(player.audio.paused ? "play" : "pause")}</button>${button("next", "Next track", "next")}</div><div class="mini-end"><span id="mini-time">${time(player.audio.currentTime)} / ${time(t.duration)}</span>${button("open-queue", "Open queue", "queue")}</div><div class="mini-progress"><span id="mini-bar"></span></div></section>`;
  updateTime();
}
function updateTime() {
  if (!player.track) return;
  const now = player.audio.currentTime || 0,
    total = player.audio.duration || player.track.duration;
  if ($("#seek") && document.activeElement !== $("#seek"))
    $("#seek").value = now;
  if ($("#elapsed")) $("#elapsed").textContent = time(now);
  if ($("#remaining")) $("#remaining").textContent = "−" + time(total - now);
  if ($("#mini-time"))
    $("#mini-time").textContent = `${time(now)} / ${time(total)}`;
  if ($("#mini-bar"))
    $("#mini-bar").style.width = `${total ? (now / total) * 100 : 0}%`;
}
function navigate(next) {
  if (!["library", "playing", "queue", "settings"].includes(next))
    next = "library";
  route = next;
  history.replaceState(null, "", "#" + next);
  render();
  window.scrollTo(0, 0);
}
function modal(html) {
  $("#dialog").innerHTML = button("close", "Close", "close", "close") + html;
  $("#dialog").showModal();
}
function confirmAction(title, copy, action, label = "Delete") {
  modal(
    `<h2>${escape(title)}</h2><p>${escape(copy)}</p><div class="actions"><button class="secondary" data-action="close">Cancel</button><button class="primary" id="confirm">${label}</button></div>`,
  );
  $("#confirm").onclick = async () => {
    $("#dialog").close();
    try {
      await action();
    } catch (e) {
      toast(db.storageError(e));
    }
  };
}
function trackOptions(id) {
  const t = tracks.find((t) => t.id === id);
  if (!t) return;
  modal(
    `<h2>${escape(t.title)}</h2><p class="notice">${escape(t.filename)} · ${bytes(t.size)}</p>${[
      ["play-next", "Play next", "next"],
      ["enqueue", "Add to queue", "queue"],
      ["playlist-add", "Add to playlist", "library"],
      ["rename", "Rename track", "rename"],
      ["delete", "Delete from library", "trash"],
    ]
      .map(
        ([a, l, img]) =>
          `<button class="menu-action ${a === "delete" ? "danger" : ""}" data-action="${a}" data-id="${id}">${icon(img)} ${l}</button>`,
      )
      .join("")}`,
  );
}
async function refreshStorage() {
  try {
    storage = await navigator.storage?.estimate();
    persisted = (await navigator.storage?.persisted?.()) || false;
  } catch {
    storage = null;
  }
}
async function refreshTracks() {
  [tracks, playlists] = await Promise.all([
    db.listTracks(),
    db.readPlaylists(),
  ]);
  await player.setLibrary(tracks);
  await refreshStorage();
  render();
}
async function removeTracks(ids) {
  await db.deleteTracks(ids);
  ids.forEach((id) => selected.delete(id));
  await refreshTracks();
  toast(`${ids.length} track${ids.length === 1 ? "" : "s"} removed.`);
}
async function importFiles(files) {
  if (importing || !storageAvailable) return;
  importing = true;
  libraryTab = "tracks";
  const batch = Array.from(files);
  let added = 0;
  const errors = [];
  navigate("library");
  for (let i = 0; i < batch.length; i++) {
    const file = batch[i];
    importMessage = `Adding ${i + 1} of ${batch.length} · ${file.name}`;
    render();
    try {
      if (
        tracks.some((t) => t.filename === file.name && t.size === file.size)
      ) {
        errors.push(`${file.name}: already in your library`);
        continue;
      }
      if (storage?.quota && storage.quota - storage.usage < file.size)
        throw new DOMException("Not enough space", "QuotaExceededError");
      const track = await inspectFile(file);
      await db.addTrack(track, file);
      tracks.push(track);
      added++;
      if (storage) storage.usage += file.size;
    } catch (e) {
      errors.push(
        `${file.name}: ${e.name === "QuotaExceededError" ? db.storageError(e) : e.message}`,
      );
    }
  }
  importing = false;
  importMessage = "";
  await player.setLibrary(tracks);
  await refreshStorage();
  render();
  $("#file-input").value = "";
  if (errors.length)
    modal(
      `<h2>${added ? `${added} track${added === 1 ? "" : "s"} added` : "Couldn’t add these files"}</h2><p>Other files in the batch were kept safely.</p><ul class="notice">${errors.map((x) => `<li>${escape(x)}</li>`).join("")}</ul><button class="primary" data-action="close">Done</button>`,
    );
  else
    toast(`${added} track${added === 1 ? "" : "s"} added. Ready when you are.`);
}
const actions = {
  add: () => $("#file-input").click(),
  reload: () => location.reload(),
  close: () => $("#dialog").close(),
  track: (e) =>
    player.start(
      e.dataset.id,
      ordered().map((t) => t.id),
    ),
  toggle: () => player.toggle(),
  previous: () => player.previous(),
  next: () => player.next(),
  back: () => player.seek(player.audio.currentTime - 10),
  forward: () => player.seek(player.audio.currentTime + 10),
  shuffle: () => player.set("shuffle", !player.state.shuffle),
  repeat: () =>
    player.set(
      "repeat",
      ["off", "all", "one"][
        (["off", "all", "one"].indexOf(player.state.repeat) + 1) % 3
      ],
    ),
  mute: () => player.set("muted", !player.state.muted),
  speed: () =>
    player.set(
      "speed",
      [0.75, 1, 1.25, 1.5, 2][
        ([0.75, 1, 1.25, 1.5, 2].indexOf(player.state.speed) + 1) % 5
      ],
    ),
  "play-all": () => {
    player.set("shuffle", false);
    const ids = ordered().map((t) => t.id);
    player.start(ids[0], ids);
  },
  "shuffle-all": () => {
    player.set("shuffle", true);
    const ids = ordered().map((t) => t.id);
    player.start(ids[Math.floor(Math.random() * ids.length)], ids);
  },
  "open-queue": () => navigate("queue"),
  options: (e) => trackOptions(e.dataset.id),
  enqueue: (e) => {
    player.enqueue(e.dataset.id);
    $("#dialog").close();
    toast("Added to your queue.");
  },
  "play-next": (e) => {
    player.enqueue(e.dataset.id, true);
    $("#dialog").close();
    toast("Playing next.");
  },
  rename: (e) => {
    const t = tracks.find((t) => t.id === e.dataset.id);
    modal(
      `<h2>Rename track</h2><form id="rename-form"><label for="title" class="notice">Track title</label><input id="title" type="text" maxlength="250" value="${escape(t.title)}" required><div class="actions"><button type="button" class="secondary" data-action="close">Cancel</button><button class="primary" type="submit">Save title</button></div></form>`,
    );
    $("#rename-form").onsubmit = async (event) => {
      event.preventDefault();
      const title = $("#title").value.trim();
      if (!title) return;
      try {
        await db.updateTrack({ ...t, title });
        $("#dialog").close();
        await refreshTracks();
        player.updateSession();
        toast("Track renamed.");
      } catch (error) {
        toast(db.storageError(error));
      }
    };
    $("#title").select();
  },
  delete: (e) => {
    const t = tracks.find((t) => t.id === e.dataset.id);
    $("#dialog").close();
    confirmAction(
      "Delete this track?",
      `“${t.title}” will be removed from Pocket and its queue. Your original file won’t be changed.`,
      () => removeTracks([t.id]),
    );
  },
  select: () => {
    selecting = !selecting;
    selected.clear();
    render();
  },
  "select-all": () => {
    selected = new Set(tracks.map((t) => t.id));
    render();
  },
  "queue-selected": () => {
    for (const id of selected) player.enqueue(id);
    selected.clear();
    selecting = false;
    render();
    toast("Selected tracks added to queue.");
  },
  "delete-selected": () =>
    confirmAction(
      `Delete ${selected.size} tracks?`,
      "This removes their copies from Pocket. Keep your original MP3 and MP4 files.",
      () => removeTracks([...selected]),
    ),
  "queue-play": (e) => player.playQueue(Number(e.dataset.index)),
  "queue-next": (e) => player.moveQueue(Number(e.dataset.index), 0),
  "queue-up": (e) =>
    player.moveQueue(Number(e.dataset.index), Number(e.dataset.index) - 1),
  "queue-down": (e) =>
    player.moveQueue(Number(e.dataset.index), Number(e.dataset.index) + 1),
  "queue-remove": (e) => player.removeQueue(Number(e.dataset.index)),
  "clear-queue": () => player.clearQueue(),
  "clear-library": () =>
    confirmAction(
      "Clear your library?",
      "All imported files will be removed from this browser. This cannot be undone. Your original files are unaffected.",
      async () => {
        await db.clearLibrary();
        await refreshTracks();
        toast("Your library is clear.");
      },
      "Clear library",
    ),
  persist: async () => {
    try {
      const granted = await navigator.storage?.persist?.();
      await refreshStorage();
      render();
      toast(
        granted
          ? "Persistent storage granted. Keep your original files as a backup."
          : "Your browser did not grant persistent storage. Adding Pocket to your Home Screen may help.",
      );
    } catch {
      toast("Persistent storage is not available in this browser.");
    }
  },
  install: () =>
    modal(
      '<h2>A home for your music.</h2><p>Install Pocket on iPhone:</p><ol><li>Open this site in <strong>Safari</strong>.</li><li>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong>, then open Pocket from its icon.</li><li>Import your MP3s and MP4s in the installed app and tap Play.</li></ol><p class="notice">Open once online so the interface can be saved. Media stays in this browser’s storage. On desktop, use your browser’s install option if available.</p><button class="primary" data-action="close">Got it</button>',
    ),
};
document.addEventListener("click", async (event) => {
  const el = event.target.closest("[data-action],[data-route]");
  if (!el || el.disabled) return;
  try {
    if (el.dataset.route) {
      navigate(el.dataset.route);
      return;
    }
    await actions[el.dataset.action]?.(el);
  } catch (error) {
    toast(error.message || "Something went wrong. Try again.");
  }
});
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.dataset.select) {
    t.checked
      ? selected.add(t.dataset.select)
      : selected.delete(t.dataset.select);
    render();
    return;
  }
  const map = {
    "repeat-setting": ["repeat", t.value],
    "speed-setting": ["speed", Number(t.value)],
    theme: ["theme", t.value],
    autoplay: ["autoplay", t.checked],
  };
  if (map[t.id]) player.set(...map[t.id]);
  if (t.id === "sort") {
    sort = t.value;
    render();
  }
  if (t.id === "eq-enabled")
    try {
      await player.enableEQ(t.checked);
    } catch {
      toast(
        "Could not start the equalizer. Native playback remains available.",
      );
      await player.enableEQ(false);
    }
  if (t.id === "preset") {
    if (t.value !== "Custom") player.preset(t.value);
    else player.set("eqPreset", "Custom");
  }
  if (t.id === "seek") player.seek(Number(t.value));
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "volume") {
    player.state.volume = Number(t.value);
    player.audio.volume = Number(t.value);
    player.persist();
  }
  if (t.dataset.band !== undefined) {
    const i = Number(t.dataset.band);
    player.band(i, Number(t.value));
    $("#gain-" + i).textContent =
      `${Number(t.value) > 0 ? "+" : ""}${t.value} dB`;
    $("#preset").value = "Custom";
  }
  if (t.id === "seek") {
    $("#elapsed").textContent = time(t.value);
    $("#remaining").textContent = "−" + time(player.track.duration - t.value);
  }
});
$("#file-input").addEventListener("change", (e) => importFiles(e.target.files));
let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  if (e.dataTransfer.types.includes("Files")) {
    e.preventDefault();
    dragDepth++;
    $("#drop-overlay").hidden = false;
  }
});
document.addEventListener("dragover", (e) => {
  if (e.dataTransfer.types.includes("Files")) e.preventDefault();
});
document.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) $("#drop-overlay").hidden = true;
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("#drop-overlay").hidden = true;
  if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
});
window.addEventListener("hashchange", () => navigate(location.hash.slice(1)));
document.addEventListener("keydown", (e) => {
  if (
    e.code === "Space" &&
    !["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(e.target.tagName) &&
    !$("#dialog").open
  ) {
    e.preventDefault();
    player.toggle();
  }
});
async function boot() {
  let saved = {};
  try {
    [tracks, saved, playlists] = await Promise.all([
      db.listTracks(),
      db.readState(),
      db.readPlaylists(),
    ]);
  } catch (e) {
    storageAvailable = false;
    toast("Local storage is unavailable. Enable website storage and reload.");
  }
  player = new Player(saved || {}, toast);
  await player.setLibrary(tracks);
  player.addEventListener("change", () => {
    if (document.activeElement?.matches("input[type=range]")) {
      renderMini();
      return;
    }
    render();
  });
  player.addEventListener("time", updateTime);
  await refreshStorage();
  navigate(location.hash.slice(1) || "library");
  await player.restore();
  if ("serviceWorker" in navigator)
    navigator.serviceWorker
      .register("./sw.js")
      .catch(() =>
        toast(
          "Offline setup didn’t finish. Reopen Pocket online to try again.",
        ),
      );
  // Optional WebMCP: expose read-only library metadata and navigation, never blobs.
  const context = document.modelContext;
  if (context?.registerTool) {
    for (const tool of [
      {
        name: "list_pocket_library",
        title: "List Pocket tracks",
        description:
          "Read titles, durations, and track IDs from the local Pocket library. Does not expose media files.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input) => {
          if (!input || Object.keys(input).length)
            throw new Error("Expected an empty object.");
          return tracks.map(({ id, title, duration, artist }) => ({
            id,
            title,
            duration,
            artist,
          }));
        },
      },
      {
        name: "open_pocket_view",
        title: "Open a Pocket screen",
        description:
          "Navigate to Library, Now Playing, Queue, or Settings. Does not start playback.",
        inputSchema: {
          type: "object",
          properties: {
            view: {
              type: "string",
              enum: ["library", "playing", "queue", "settings"],
            },
          },
          required: ["view"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input) => {
          if (
            !input ||
            Object.keys(input).length !== 1 ||
            !["library", "playing", "queue", "settings"].includes(input.view)
          )
            throw new Error("Invalid view.");
          navigate(input.view);
          return { view: route };
        },
      },
    ])
      try {
        await context.registerTool(tool);
      } catch {
        /* Optional browser API. */
      }
  }
}

function libraryTabs() {
  return `<div class="library-tabs" role="group" aria-label="Library view"><button class="${libraryTab === "tracks" ? "chosen" : ""}" data-action="show-tracks">Tracks <span>${tracks.length}</span></button><button class="${libraryTab === "playlists" ? "chosen" : ""}" data-action="show-playlists">Playlists <span>${playlists.length}</span></button></div>`;
}
function playlistView() {
  const p = playlists.find((p) => p.id === openedPlaylist);
  const header = `${top()}<header class="page-header"><div><h1>${p ? escape(p.name) : "Your playlists"}</h1><p>${p ? `${p.trackIds.length} tracks · Made by you` : "A collection for every kind of day."}</p></div><button class="primary" data-action="${p ? "playlist-edit-tracks" : "playlist-create"}">${icon("plus")} ${p ? "Add tracks" : "Create"}</button></header>${libraryTabs()}`;
  if (!p)
    return (
      header +
      (playlists.length
        ? `<div class="playlist-grid">${playlists
            .map((item) => {
              const t = tracks.find((t) => t.id === item.trackIds[0]);
              return `<button class="playlist-card" data-action="playlist-open" data-id="${item.id}"><div class="playlist-cover">${art(t)}<span>${icon("library")}</span></div><strong>${escape(item.name)}</strong><small>${item.trackIds.length} tracks</small></button>`;
            })
            .join("")}</div>`
        : `<section class="empty">${icon("library")}<h2>Give your favorites a place.</h2><p>Create a playlist, add tracks from your library, and put them in your perfect order.</p><button class="primary" data-action="playlist-create">${icon("plus")} Create playlist</button></section>`)
    );
  return (
    header +
    `<div class="playlist-toolbar"><button class="text-button" data-action="show-playlists">← All playlists</button><div>${button("playlist-rename", "Rename playlist", "rename")}${button("playlist-delete", "Delete playlist", "trash")}</div></div><div class="selection-bar"><button class="primary" data-action="playlist-play" ${p.trackIds.length ? "" : "disabled"}>${icon("play")} Play</button><button class="secondary" data-action="playlist-shuffle" ${p.trackIds.length ? "" : "disabled"}>${icon("shuffle")} Shuffle</button><button class="secondary" data-action="playlist-queue" ${p.trackIds.length ? "" : "disabled"}>Add to queue</button></div>` +
    (p.trackIds.length
      ? p.trackIds
          .map((id, i) => {
            const t = tracks.find((t) => t.id === id);
            if (!t) return "";
            return `<article class="track queue-track">${art(t)}<div><button class="track-title" data-action="playlist-track" data-id="${id}">${escape(t.title)}</button><div class="track-meta">${escape(t.artist || t.format || "Local audio")} · ${time(t.duration)}</div></div><div class="queue-actions">${button("playlist-up", "Move up", "up", "", `data-index="${i}" ${i === 0 ? "disabled" : ""}`)}${button("playlist-down", "Move down", "down", "", `data-index="${i}" ${i === p.trackIds.length - 1 ? "disabled" : ""}`)}${button("playlist-remove", "Remove from playlist", "close", "", `data-index="${i}"`)}</div></article>`;
          })
          .join("")
      : empty(
          "Your mix starts here.",
          "Tap Add tracks to choose from your library. Removing a track from a playlist keeps its original in your library.",
          false,
        ))
  );
}
async function savePlaylists(next) {
  await db.writePlaylists(next);
  playlists = next;
  render();
}
function currentPlaylist() {
  const p = playlists.find((p) => p.id === openedPlaylist);
  if (!p) throw new Error("Choose a playlist first.");
  return p;
}
async function savePlaylist(p) {
  await savePlaylists(playlists.map((item) => (item.id === p.id ? p : item)));
}
function playlistNameDialog(existing = null, ids = []) {
  modal(
    `<h2>${existing ? "Rename playlist" : "Create playlist"}</h2><form id="playlist-form"><label class="notice" for="playlist-name">Playlist name</label><input type="text" id="playlist-name" placeholder="Late-night favorites" maxlength="80" value="${escape(existing?.name || "")}" required><div class="actions"><button type="button" class="secondary" data-action="close">Cancel</button><button type="submit" class="primary">${existing ? "Save" : "Create playlist"}</button></div></form>`,
  );
  $("#playlist-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const name = $("#playlist-name").value.trim();
      if (!name) return;
      const p = existing ? { ...existing, name } : makePlaylist(name, ids);
      await savePlaylists(
        existing
          ? playlists.map((x) => (x.id === p.id ? p : x))
          : [p, ...playlists],
      );
      $("#dialog").close();
      openedPlaylist = p.id;
      libraryTab = "playlists";
      navigate("library");
      toast(existing ? "Playlist renamed." : "Playlist created.");
    } catch (error) {
      toast(db.storageError(error));
    }
  };
  $("#playlist-name").focus();
}
function pickPlaylist(ids) {
  if ($("#dialog").open) $("#dialog").close();
  modal(
    `<h2>Add to playlist</h2><p>${ids.length} track${ids.length === 1 ? "" : "s"} selected</p><div class="playlist-choices">${playlists.map((p) => `<button class="menu-action" data-pick-playlist="${p.id}">${icon("library")} ${escape(p.name)}</button>`).join("")}</div><button class="primary" id="new-playlist">${icon("plus")} New playlist</button>`,
  );
  $("#new-playlist").onclick = () => {
    $("#dialog").close();
    playlistNameDialog(null, ids);
  };
  for (const el of document.querySelectorAll("[data-pick-playlist]"))
    el.onclick = async () => {
      try {
        const p = playlists.find((p) => p.id === el.dataset.pickPlaylist);
        await savePlaylist(addToPlaylist(p, ids));
        $("#dialog").close();
        toast(`Added to ${p.name}.`);
      } catch (e) {
        toast(db.storageError(e));
      }
    };
}
function editPlaylistTracks() {
  const p = currentPlaylist();
  if (!tracks.length) {
    toast("Add MP3 or MP4 files to your library first.");
    libraryTab = "tracks";
    render();
    return;
  }
  const ids = new Set(p.trackIds);
  modal(
    `<h2>Add tracks</h2><p>Select the tracks to keep in ${escape(p.name)}.</p><div class="playlist-choices">${ordered()
      .map(
        (t) =>
          `<label class="playlist-choice"><input type="checkbox" class="track-check" data-playlist-check="${t.id}" ${ids.has(t.id) ? "checked" : ""}><span>${escape(t.title)}<small>${escape(t.artist || t.format || "Local audio")}</small></span></label>`,
      )
      .join(
        "",
      )}</div><div class="actions"><button class="secondary" data-action="close">Cancel</button><button class="primary" id="save-playlist-tracks">Save tracks</button></div>`,
  );
  $("#save-playlist-tracks").onclick = async () => {
    const checked = [
      ...document.querySelectorAll("[data-playlist-check]:checked"),
    ].map((el) => el.dataset.playlistCheck);
    const next = [
      ...p.trackIds.filter((id) => checked.includes(id)),
      ...checked.filter((id) => !ids.has(id)),
    ];
    try {
      await savePlaylist({ ...p, trackIds: next });
      $("#dialog").close();
      toast("Playlist updated.");
    } catch (e) {
      toast(db.storageError(e));
    }
  };
}
Object.assign(actions, {
  "show-tracks": () => {
    libraryTab = "tracks";
    openedPlaylist = null;
    render();
  },
  "show-playlists": () => {
    libraryTab = "playlists";
    openedPlaylist = null;
    render();
  },
  "playlist-create": () => playlistNameDialog(),
  "playlist-open": (e) => {
    openedPlaylist = e.dataset.id;
    libraryTab = "playlists";
    render();
  },
  "playlist-rename": () => playlistNameDialog(currentPlaylist()),
  "playlist-delete": () => {
    const p = currentPlaylist();
    confirmAction(
      "Delete this playlist?",
      `“${p.name}” will be deleted. Its tracks will stay in your library.`,
      async () => {
        await savePlaylists(playlists.filter((x) => x.id !== p.id));
        openedPlaylist = null;
        render();
        toast("Playlist deleted.");
      },
    );
  },
  "playlist-add": (e) => pickPlaylist([e.dataset.id]),
  "playlist-selected": () => pickPlaylist([...selected]),
  "playlist-edit-tracks": editPlaylistTracks,
  "playlist-play": () => {
    const p = currentPlaylist();
    player.set("shuffle", false);
    player.start(p.trackIds[0], p.trackIds);
  },
  "playlist-shuffle": () => {
    const p = currentPlaylist();
    player.set("shuffle", true);
    player.start(
      p.trackIds[Math.floor(Math.random() * p.trackIds.length)],
      p.trackIds,
    );
  },
  "playlist-track": (e) =>
    player.start(e.dataset.id, currentPlaylist().trackIds),
  "playlist-queue": () => {
    for (const id of currentPlaylist().trackIds) player.enqueue(id);
    toast("Playlist added to queue.");
  },
  "playlist-up": (e) => {
    const p = currentPlaylist(),
      i = Number(e.dataset.index);
    return savePlaylist({ ...p, trackIds: moveItem(p.trackIds, i, i - 1) });
  },
  "playlist-down": (e) => {
    const p = currentPlaylist(),
      i = Number(e.dataset.index);
    return savePlaylist({ ...p, trackIds: moveItem(p.trackIds, i, i + 1) });
  },
  "playlist-remove": (e) => {
    const p = currentPlaylist();
    return savePlaylist({
      ...p,
      trackIds: p.trackIds.filter((_, i) => i !== Number(e.dataset.index)),
    });
  },
});
boot().catch((e) => toast(`Pocket couldn’t start: ${e.message}`));
