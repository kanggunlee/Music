# Pocket

A polished, mobile-first, offline-capable personal music player for **MP3 and MP4** files. Media and metadata stay in the current browser's IndexedDB. There is no media upload endpoint, backend, account, analytics, or external asset dependency.

## Run locally

Requirements: Python 3. Node.js 20+ is only needed for automated checks.

```sh
python3 -m http.server 4173 --directory dist
```

Open http://localhost:4173. Use `localhost` for service-worker support. Opening index.html directly from disk is not supported. All source is readable JavaScript modules; there is no installation or build step.

## Deploy to a public HTTPS URL

Publish the **contents of `dist/`**, preserving filenames, using any static HTTPS host. Relative URLs support a subdirectory such as `/Music/`. Serve JavaScript as JavaScript, the manifest as JSON, and `sw.js` without long-lived HTTP caching. Use HTTPS; service workers are unavailable on ordinary HTTP except localhost.

For GitHub Pages: open repository Settings → Pages, choose GitHub Actions as the source, then run the included **Deploy Pocket** workflow from Actions. Availability for private repositories depends on your GitHub plan. The workflow uploads only `dist/`; it never uploads personal media. Do not rename the app's URL after importing a library: browser data belongs to an origin, and moving hosts creates a separate library.

After each release, change the cache version in `dist/sw.js`. The service worker installs the whole interface before activation. A new version activates immediately; reload open clients after updating. Imported media is not part of the service-worker cache.

## Install on iPhone

1. Open the deployed HTTPS link in Safari.
2. Tap **Share → Add to Home Screen → Add**. Enable **Open as Web App** if offered.
3. Launch Pocket from its icon while online once, then import your files there.
4. Tap a track to start. The installed app's library may be separate from Safari's library.

The app shell and saved media work offline once cached/imported. Keep original files: the browser can evict storage, users can clear website data, and persistent-storage requests can be denied. Private browsing is unsuitable for a durable library. No cross-device sync or backup is provided.

## Everyday use on iPhone

- **Import:** tap **Add files**, open Browse in the Files picker, select MP3 or MP4 files, then confirm. Cloud files must download through Files first. Pocket saves its own local copy.
- **Listen:** tap a track title. Use the bottom mini player to pause/skip, or tap its title for Now Playing and the scrubber. Use the iPhone volume buttons.
- **Create a playlist:** go to **Library → Playlists → Create**, enter a name, then tap **Add tracks**. Select tracks and choose **Save tracks**.
- **Organize:** open a playlist and use the arrows to reorder it. The × removes a track only from that playlist. Use the rename or delete button for the playlist itself.
- **Add from the library:** tap a track’s options → **Add to playlist**, or use **Select** for multiple tracks. New playlist is available in the chooser.
- **Play a playlist:** tap **Play** or **Shuffle**. Repeat all loops the collection you started. **Add to queue** appends it to the current upcoming tracks.
- **Offline:** after opening the app online once and importing your files, turn off the network and keep listening.
- **Background:** start a track before locking the phone. If it stops, reopen Pocket, turn the equalizer off, and tap Play.

## Features

- Single or multiple MP3/MP4 imports, native file picker, desktop drop zone.
- Duration and MP4 frame extraction. Common MP4/iTunes and ID3v2.3/v2.4 title, artist, and cover tags; unsupported tags use filename and generated color artwork.
- Sorting, renaming, deletion confirmation, and multi-selection.
- Saved playlists with creation, renaming, track selection, ordering, removal, playlist play/shuffle, and queue append. Deleting a media file prunes its playlist references atomically.
- Native audio element separate from the interface; screen navigation never recreates it.
- Mini player, full player, seeking, ±10 seconds, speed, mute, volume.
- Editable upcoming queue, play next, reorder, remove, clear; previous-track history.
- Shuffle, repeat off/all/one, sequential auto-advance, optional autoplay.
- Persisted library, queue, current track and position, theme, volume, speed, shuffle/repeat, EQ.
- Media Session metadata and supported lock-screen/headphone actions.
- Optional real five-band Web Audio EQ and seven presets including Custom, with preamp headroom to reduce clipping.
- Offline shell, manifest, PNG icons, safe-area spacing, dark/light themes, keyboard and screen-reader labels.
- Feature-detected WebMCP metadata listing/navigation; it never exposes file bytes.

## Behavior and limitations

MP4 is a container, not a codec. A playable audio stream is required; AAC is the most interoperable choice. Video-only MP4s can be silent, and exotic codecs/DRM are unsupported. The app uses an audio element during listening. Duration validation detects obvious corruption and unsupported containers, but browser decoders are the final authority. Thumbnail extraction and optional metadata parsing can fall back without blocking import. Duplicate filename + size pairs are skipped.

Playback requires user activation. A delayed first IndexedDB read can lose activation on some browsers; the app asks for another Play tap. The next queued file is prepared in advance for auto-advance. Returning to a saved session restores the position without starting sound automatically.

**iOS:** native audio is the default for reliability. Safari decides whether background audio and lock-screen actions remain available; this is not guaranteed across all iOS versions. Web Audio has documented background/PWA interruption issues. EQ is off by default and disabling it replaces the media element to fully restore native playback. If interrupted, reopen Pocket and tap Play. Volume sliders cannot override hardware volume on iPhone; use device buttons. A service worker does not keep audio alive when iOS terminates the app.

Settings and playback position are saved every few seconds and on relevant lifecycle events; a force-quit can lose the last few seconds. Persistent storage is requested explicitly in Settings. Data and media writes are transactional. Storage failures leave the previous saved library intact. Large imports are handled one at a time.

## Source layout

- `dist/app.js`: screens, accessible controls, imports, dialogs, optional WebMCP.
- `dist/player.js`: long-lived playback engine, EQ, Media Session, state persistence.
- `dist/store.js`: IndexedDB transactions and media storage.
- `dist/metadata.js`: bounded MP4 and ID3 parsing, duration and thumbnails.
- `dist/queue.js`: pure queue/shuffle decisions.
- `dist/playlists.js`: playlist operations and reference cleanup.
- `dist/style.css`: responsive theme and safe-area layout.
- `dist/sw.js`, `dist/manifest.webmanifest`: offline/install setup.
- `tests/*.test.js`: automated queue and playlist behavior checks.

## Validate

```sh
npm test
npm run check
```

Before a release on a target iPhone: import both formats, play/seek/pause, switch screens, reorder queue, lock screen, reconnect headphones, close/reopen, then enable airplane mode and reopen. Test EQ both on and off. Browser automation does not substitute for physical iPhone verification.

## Platform references

- [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/MediaSession)
- [WebKit background AudioContext issue](https://bugs.webkit.org/show_bug.cgi?id=261554)
- [WebKit PWA AudioContext resume issue](https://bugs.webkit.org/show_bug.cgi?id=291892)

## Browser integration checks

Serve the repository root on a **separate, disposable origin**, for example `python3 -m http.server 4174`, then open `http://localhost:4174/tests/browser.html` and press Run checks. This intentionally clears Pocket data on that test origin, so never run it on the origin containing your personal library. Included fixtures are generated low-volume sine tones, not commercial music.

The browser suite checks decoding and tag extraction for both formats, invalid-file rejection, transactional media storage, playlist persistence and cleanup, playback/seek/pause/next, repeat, EQ gain changes and native fallback, saved position/modes, and deletion.

## Home Screen app experience

Pocket is an installable web app. On iPhone, open the **deployed Pocket link** in Safari (not the GitHub source page), choose Share → Add to Home Screen, leave **Open as Web App** enabled when offered, then launch the new Pocket icon. This launches a standalone app window without Safari’s toolbar. Opening the ordinary link remains a browser session.

The mobile interface uses a fixed screen with separate scrolling content, Library/Playlists/Queue/Settings tabs, a persistent mini player, and a full-screen Now Playing view. Tap the mini player to expand it; use the down chevron or swipe down on the artwork to return. Track options open as bottom sheets. An installation suggestion appears in mobile browsers and hides when running standalone.

No App Store installation is required. Home Screen installation does not make this a native iOS binary or remove Safari’s background-audio restrictions. Your existing library is not uploaded or automatically transferred between browser contexts.
