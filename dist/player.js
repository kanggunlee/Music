import { getMedia, writeState } from "./store.js";
import { shuffled, nextDecision, moveItem } from "./queue.js";
export const frequencies = [60, 250, 1000, 4000, 12000];
export const presets = {
  Flat: [0, 0, 0, 0, 0],
  "Bass Boost": [6, 4, 0, -1, -1],
  "Treble Boost": [-1, 0, 0, 4, 6],
  Vocal: [-3, -1, 4, 3, -1],
  Acoustic: [3, 2, 0, 2, 3],
  Electronic: [5, 3, -2, 3, 5],
};
export const defaults = {
  current: null,
  queue: [],
  cycle: [],
  history: [],
  position: 0,
  shuffle: false,
  repeat: "off",
  autoplay: true,
  speed: 1,
  volume: 1,
  muted: false,
  theme: "dark",
  eqEnabled: false,
  eqPreset: "Flat",
  bands: [0, 0, 0, 0, 0],
};
export class Player extends EventTarget {
  constructor(saved = {}, onError = () => {}) {
    super();
    this.state = { ...defaults, ...saved };
    this.state.queue = Array.isArray(this.state.queue) ? this.state.queue : [];
    this.state.history = Array.isArray(this.state.history)
      ? this.state.history
      : [];
    this.state.cycle = Array.isArray(this.state.cycle) ? this.state.cycle : [];
    this.state.bands =
      Array.isArray(this.state.bands) && this.state.bands.length === 5
        ? this.state.bands
        : [0, 0, 0, 0, 0];
    this.onError = onError;
    this.library = [];
    this.urls = new Map();
    this.generation = 0;
    this.lastSave = 0;
    this.makeAudio();
    this.mediaSession();
    document.addEventListener("visibilitychange", () => {
      this.persist();
      if (
        document.visibilityState === "visible" &&
        this.state.eqEnabled &&
        !this.audio.paused
      )
        this.context?.resume().catch(() => {});
    });
    window.addEventListener("pagehide", () => this.persist());
  }
  makeAudio() {
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.playbackRate = this.state.speed;
    this.audio.volume = this.state.volume;
    this.audio.muted = this.state.muted;
    for (const event of [
      "play",
      "pause",
      "loadedmetadata",
      "durationchange",
      "ratechange",
    ])
      this.audio.addEventListener(event, () => {
        this.updateSession();
        this.emit();
      });
    this.audio.addEventListener("timeupdate", () => {
      this.state.position = this.audio.currentTime;
      this.dispatchEvent(new Event("time"));
      this.updatePosition();
      if (Date.now() - this.lastSave > 3000) this.persist();
    });
    this.audio.addEventListener("ended", () => {
      this.next(true);
    });
    this.audio.addEventListener("error", () => {
      if (this.audio.src)
        this.onError(
          "This track could not play. Try an MP3 or an MP4 with AAC audio, or import the original file again.",
        );
      this.emit();
    });
  }
  emit() {
    this.dispatchEvent(new Event("change"));
  }
  persist() {
    this.lastSave = Date.now();
    const snapshot = structuredClone(this.state);
    writeState(snapshot).catch((e) => {
      if (!this.saveFailed) {
        this.onError(
          "Playback settings could not be saved. Check available storage.",
        );
        this.saveFailed = true;
      }
    });
  }
  async setLibrary(tracks) {
    this.library = tracks;
    const ids = new Set(tracks.map((t) => t.id));
    this.state.queue = this.state.queue.filter((id) => ids.has(id));
    this.state.cycle = this.state.cycle.filter((id) => ids.has(id));
    this.state.history = this.state.history.filter((id) => ids.has(id));
    for (const [id, url] of this.urls)
      if (!ids.has(id)) {
        URL.revokeObjectURL(url);
        this.urls.delete(id);
      }
    if (this.state.current && !ids.has(this.state.current)) {
      this.generation++;
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.state.current = null;
      this.state.position = 0;
    }
    this.persist();
    this.emit();
  }
  get track() {
    return this.library.find((t) => t.id === this.state.current);
  }
  async prepare(id) {
    if (this.urls.has(id)) return this.urls.get(id);
    const blob = await getMedia(id);
    if (!blob)
      throw new Error(
        "This file is no longer stored on this device. Please import it again.",
      );
    const url = URL.createObjectURL(blob);
    this.urls.set(id, url);
    return url;
  }
  async restore() {
    if (this.state.current) {
      try {
        const url = await this.prepare(this.state.current);
        this.audio.src = url;
        this.restorePosition(this.state.position);
      } catch (e) {
        this.onError(e.message);
      }
    }
    this.emit();
  }
  restorePosition(position) {
    const seek = () => {
      if (Number.isFinite(this.audio.duration))
        this.audio.currentTime = Math.max(
          0,
          Math.min(position || 0, Math.max(0, this.audio.duration - 0.1)),
        );
    };
    if (this.audio.readyState >= 1) seek();
    else this.audio.addEventListener("loadedmetadata", seek, { once: true });
  }
  async warmNext() {
    const next = this.state.queue[0];
    if (next)
      try {
        await this.prepare(next);
      } catch {
        /* Report only when selected. */
      }
    const keep = new Set([this.state.current, next, this.state.history.at(-1)]);
    for (const [id, url] of this.urls)
      if (!keep.has(id)) {
        URL.revokeObjectURL(url);
        this.urls.delete(id);
      }
  }
  async select(id, { play = true, remember = true } = {}) {
    if (!this.library.some((t) => t.id === id)) return;
    const token = ++this.generation;
    try {
      // Activate the audio context inside the originating tap, before storage reads.
      if (play && this.state.eqEnabled) await this.enableEQ(true);
      const url = this.urls.get(id) || (await this.prepare(id));
      if (token !== this.generation) return;
      if (remember && this.state.current && this.state.current !== id)
        this.state.history.push(this.state.current);
      this.state.history = this.state.history.slice(-100);
      this.state.current = id;
      this.state.position = 0;
      this.audio.src = url;
      this.audio.playbackRate = this.state.speed;
      this.emit();
      this.persist();
      this.updateSession();
      if (play) await this.play();
      this.warmNext();
    } catch (e) {
      this.onError(e.message || "Could not load this track.");
    }
  }
  start(id, ordered = this.library.map((t) => t.id)) {
    this.state.cycle = [...ordered];
    const index = ordered.indexOf(id);
    this.state.queue = this.state.shuffle
      ? shuffled(ordered.filter((x) => x !== id))
      : ordered.slice(index + 1);
    this.state.history = [];
    return this.select(id, { remember: false });
  }
  async play() {
    try {
      if (this.state.eqEnabled) await this.enableEQ(true);
      if (!this.state.current) {
        if (this.library[0]) return this.start(this.library[0].id);
        return;
      }
      // Native audio remains the default path for iPhone background playback.
      if (!this.audio.src) {
        const url = await this.prepare(this.state.current);
        this.audio.src = url;
        this.restorePosition(this.state.position);
      }
      await this.audio.play();
    } catch (e) {
      this.onError(
        e.name === "NotAllowedError"
          ? "Tap Play to allow audio on this device."
          : `Playback stopped. ${e.message || "Try Play again."}`,
      );
    }
  }
  toggle() {
    if (this.audio.paused) return this.play();
    this.audio.pause();
    this.persist();
  }
  next(ended = false) {
    const decision = nextDecision(
      {
        ...this.state,
        library: this.state.cycle.length
          ? this.state.cycle
          : this.library.map((t) => t.id),
      },
      ended,
    );
    if (!decision) {
      if (ended) {
        this.audio.pause();
        this.state.position = 0;
        this.persist();
      }
      this.emit();
      return;
    }
    this.state.queue = decision.queue;
    if (decision.restart) {
      this.audio.currentTime = 0;
      this.play();
      this.persist();
      this.emit();
    } else this.select(decision.id);
  }
  previous() {
    if (this.audio.currentTime > 3) {
      this.seek(0);
      return;
    }
    const previous = this.state.history.pop();
    if (previous) {
      if (this.state.current) this.state.queue.unshift(this.state.current);
      this.select(previous, { remember: false });
    } else this.seek(0);
  }
  seek(time) {
    if (Number.isFinite(this.audio.duration)) {
      this.audio.currentTime = Math.max(0, Math.min(time, this.audio.duration));
      this.state.position = this.audio.currentTime;
      this.persist();
      this.dispatchEvent(new Event("time"));
    }
  }
  enqueue(id, next = false) {
    if (!this.library.some((t) => t.id === id)) return;
    next ? this.state.queue.unshift(id) : this.state.queue.push(id);
    this.persist();
    this.emit();
    this.warmNext();
  }
  moveQueue(from, to) {
    this.state.queue = moveItem(this.state.queue, from, to);
    this.persist();
    this.emit();
    this.warmNext();
  }
  removeQueue(index) {
    this.state.queue.splice(index, 1);
    this.persist();
    this.emit();
    this.warmNext();
  }
  clearQueue() {
    this.state.queue = [];
    this.persist();
    this.emit();
  }
  playQueue(index) {
    const id = this.state.queue[index];
    if (!id) return;
    this.state.queue.splice(index, 1);
    this.select(id);
  }
  set(key, value) {
    this.state[key] = value;
    if (key === "shuffle" && value)
      this.state.queue = shuffled(this.state.queue);
    if (key === "shuffle" && !value) {
      const order = this.state.cycle.length
        ? this.state.cycle
        : this.library.map((t) => t.id);
      this.state.queue.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    if (key === "speed") this.audio.playbackRate = value;
    if (key === "volume") this.audio.volume = value;
    if (key === "muted") this.audio.muted = value;
    this.persist();
    this.emit();
  }
  async enableEQ(enabled) {
    if (!enabled && this.context) {
      // MediaElementSource cannot be detached from an element. Replace it with a
      // fresh native element so disabling EQ truly restores the native audio path.
      const old = this.audio,
        src = old.src,
        position = old.currentTime,
        playing = !old.paused;
      old.pause();
      this.source?.disconnect();
      this.context.close().catch(() => {});
      this.context = null;
      this.source = null;
      this.filters = null;
      this.makeAudio();
      if (src) {
        this.audio.src = src;
        this.restorePosition(position);
      }
      if (playing)
        this.audio
          .play()
          .catch(() => this.onError("Tap Play to resume native audio."));
    }
    if (enabled) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) {
        this.onError(
          "An equalizer is not supported in this browser. Native playback is still available.",
        );
        this.state.eqEnabled = false;
        this.emit();
        return;
      }
      if (!this.context) {
        this.context = new Context();
        this.source = this.context.createMediaElementSource(this.audio);
        this.preamp = this.context.createGain();
        this.filters = frequencies.map((frequency) => {
          const f = this.context.createBiquadFilter();
          f.type = "peaking";
          f.frequency.value = frequency;
          f.Q.value = 1;
          return f;
        });
        let previous = this.source;
        previous.connect(this.preamp);
        previous = this.preamp;
        for (const filter of this.filters) {
          previous.connect(filter);
          previous = filter;
        }
        previous.connect(this.context.destination);
      }
      await this.context.resume();
      this.applyBands();
    }
    this.state.eqEnabled = enabled;
    this.persist();
    this.emit();
  }
  applyBands() {
    if (!this.context) return;
    this.state.bands.forEach((gain, i) => {
      const param = this.filters[i].gain;
      param.cancelScheduledValues(this.context.currentTime);
      param.setTargetAtTime(gain, this.context.currentTime, 0.03);
    });
    this.preamp.gain.setTargetAtTime(
      10 ** (-Math.max(0, ...this.state.bands) / 20),
      this.context.currentTime,
      0.03,
    );
  }
  preset(name) {
    if (!presets[name]) return;
    this.state.eqPreset = name;
    this.state.bands = [...presets[name]];
    this.applyBands();
    this.persist();
    this.emit();
  }
  band(index, gain) {
    this.state.eqPreset = "Custom";
    this.state.bands[index] = gain;
    this.applyBands();
    this.persist();
  }
  mediaSession() {
    if (!("mediaSession" in navigator)) return;
    const actions = {
      play: () => this.play(),
      pause: () => {
        this.audio.pause();
        this.persist();
      },
      previoustrack: () => this.previous(),
      nexttrack: () => this.next(),
      seekbackward: (d) =>
        this.seek(this.audio.currentTime - (d.seekOffset || 10)),
      seekforward: (d) =>
        this.seek(this.audio.currentTime + (d.seekOffset || 10)),
      seekto: (d) => this.seek(d.seekTime),
      stop: () => {
        this.audio.pause();
        this.seek(0);
      },
    };
    for (const [name, fn] of Object.entries(actions))
      try {
        navigator.mediaSession.setActionHandler(name, fn);
      } catch {
        /* Per-action support varies. */
      }
  }
  updateSession() {
    if (!("mediaSession" in navigator)) return;
    const t = this.track;
    if (t && typeof MediaMetadata !== "undefined")
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist || "Pocket · Local audio",
        album: "Your library",
        artwork: t.cover
          ? [{ src: t.cover }]
          : [
              {
                src: new URL("./icon-512.png", location.href).href,
                sizes: "512x512",
                type: "image/png",
              },
            ],
      });
    else navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = this.audio.paused
      ? "paused"
      : "playing";
    this.updatePosition();
  }
  updatePosition() {
    if (!navigator.mediaSession?.setPositionState) return;
    const duration = this.audio.duration;
    if (Number.isFinite(duration) && duration > 0)
      try {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: this.audio.playbackRate,
          position: Math.min(duration, Math.max(0, this.audio.currentTime)),
        });
      } catch {}
  }
}
