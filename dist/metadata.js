/** Bounded ISO BMFF metadata reader. Walk atom headers without loading the media
 * payload. Supports common iTunes title/artist/cover tags; all tags are optional. */
async function embedded(file) {
  const result = {};
  let visited = 0;
  const text = new TextDecoder();
  async function walk(start, end, depth = 0) {
    if (depth > 7) return;
    for (let pos = start; pos + 8 <= end && visited++ < 2500; ) {
      const buf = await file.slice(pos, pos + 16).arrayBuffer();
      const view = new DataView(buf);
      let size = view.getUint32(0),
        header = 8;
      const type = String.fromCharCode(...new Uint8Array(buf, 4, 4));
      if (size === 1) {
        if (buf.byteLength < 16) return;
        size = Number(view.getBigUint64(8));
        header = 16;
      }
      if (size === 0) size = end - pos;
      if (!Number.isSafeInteger(size) || size < header || pos + size > end)
        return;
      if (["moov", "udta", "meta", "ilst"].includes(type))
        await walk(
          pos + header + (type === "meta" ? 4 : 0),
          pos + size,
          depth + 1,
        );
      if (
        ["©nam", "©ART", "aART", "covr"].includes(type) &&
        size < 6 * 1024 * 1024
      ) {
        const tag = new Uint8Array(
          await file.slice(pos + header, pos + size).arrayBuffer(),
        );
        for (let n = 0; n + 16 <= tag.length; ) {
          const v = new DataView(tag.buffer, n);
          const length = v.getUint32(0);
          if (length < 16 || n + length > tag.length) break;
          if (String.fromCharCode(...tag.slice(n + 4, n + 8)) === "data") {
            const value = tag.slice(n + 16, n + length);
            const kind = v.getUint32(8) & 0xffffff;
            if (type === "covr" && [13, 14].includes(kind)) {
              const mime = kind === 13 ? "image/jpeg" : "image/png";
              result.cover = await new Promise((resolve) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.onerror = () => resolve(null);
                r.readAsDataURL(new Blob([value], { type: mime }));
              });
            } else if (type === "©nam")
              result.title = text
                .decode(value)
                .replace(/\0/g, "")
                .trim()
                .slice(0, 250);
            else if (type !== "covr" && !result.artist)
              result.artist = text
                .decode(value)
                .replace(/\0/g, "")
                .trim()
                .slice(0, 250);
          }
          n += length;
        }
      }
      pos += size;
    }
  }
  await walk(0, file.size);
  return result;
}
export async function inspectFile(file) {
  const isMP3 = /\.mp3$/i.test(file.name);
  if (!/\.(mp3|mp4)$/i.test(file.name) || file.size < 16)
    throw new Error("Choose a valid .mp3 or .mp4 file.");
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  if (!isMP3 && !new TextDecoder("latin1").decode(head).includes("ftyp"))
    throw new Error("This file does not appear to be an MP4.");
  if (
    isMP3 &&
    !(head[0] === 73 && head[1] === 68 && head[2] === 51) &&
    !head.some((x, i) => x === 255 && (head[i + 1] & 224) === 224)
  )
    throw new Error("This file does not appear to be an MP3.");
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const url = URL.createObjectURL(file);
  let cover = null;
  try {
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              "Could not read this audio file. Its codec may not be supported.",
            ),
          ),
        15000,
      );
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(
          new Error("This audio file is damaged or uses an unsupported codec."),
        );
      };
    });
    video.src = url;
    await ready;
    if (!Number.isFinite(video.duration) || video.duration <= 0)
      throw new Error("This file has no playable duration.");
    const duration = video.duration;
    if (video.videoWidth && video.videoHeight) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1800);
        video.onseeked = () => {
          clearTimeout(timer);
          resolve();
        };
        video.currentTime = Math.min(1, duration / 3);
      });
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 400;
        canvas.height = 400;
        const c = canvas.getContext("2d");
        const side = Math.min(video.videoWidth, video.videoHeight);
        c.drawImage(
          video,
          (video.videoWidth - side) / 2,
          (video.videoHeight - side) / 2,
          side,
          side,
          0,
          0,
          400,
          400,
        );
        cover = canvas.toDataURL("image/jpeg", 0.78);
      } catch {
        /* Artwork is optional. */
      }
    }
    let tags = {};
    try {
      tags = await (isMP3 ? id3(file) : embedded(file));
    } catch {
      /* Malformed optional tags never prevent playback. */
    }
    return {
      id: crypto.randomUUID(),
      title:
        tags.title ||
        file.name.replace(/\.(mp3|mp4)$/i, "").replace(/[_]/g, " "),
      artist: tags.artist || "",
      filename: file.name,
      format: isMP3 ? "MP3" : "MP4",
      duration,
      size: file.size,
      added: Date.now(),
      cover: tags.cover || cover,
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

// ID3v2.3/v2.4: title, performer, and attached JPEG/PNG artwork.
async function id3(file) {
  const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (String.fromCharCode(...header.slice(0, 3)) !== "ID3") return {};
  const sync = (a) => a.reduce((n, v) => (n << 7) | (v & 127), 0),
    version = header[3];
  if (![3, 4].includes(version) || header[5] & 128) return {};
  const length = sync(header.slice(6, 10));
  if (length > 8 * 1024 * 1024) return {};
  const data = new Uint8Array(await file.slice(10, 10 + length).arrayBuffer()),
    result = {};
  let start = 0;
  if (header[5] & 64) {
    if (data.length < 4) return {};
    start =
      version === 4
        ? sync(data.slice(0, 4))
        : new DataView(data.buffer).getUint32(0) + 4;
  }
  const decode = (value, encoding) => {
    try {
      return new TextDecoder(
        encoding === 1
          ? "utf-16"
          : encoding === 2
            ? "utf-16be"
            : encoding === 3
              ? "utf-8"
              : "windows-1252",
      )
        .decode(value)
        .replace(/\0/g, "")
        .trim()
        .slice(0, 250);
    } catch {
      return "";
    }
  };
  for (let p = start; p + 10 <= data.length; ) {
    const name = String.fromCharCode(...data.slice(p, p + 4));
    const size =
      version === 4
        ? sync(data.slice(p + 4, p + 8))
        : new DataView(data.buffer, p + 4, 4).getUint32(0);
    if (!size || p + 10 + size > data.length) break;
    const flags = data[p + 9];
    const value = data.slice(p + 10, p + 10 + size);
    p += 10 + size;
    if (flags) continue;
    if (name === "TIT2") result.title = decode(value.slice(1), value[0]);
    if (name === "TPE1") result.artist = decode(value.slice(1), value[0]);
    if (name === "APIC" && value.length < 5 * 1024 * 1024) {
      const encoding = value[0];
      let end = 1;
      while (end < value.length && value[end]) end++;
      const mime = new TextDecoder().decode(value.slice(1, end));
      let offset = end + 2;
      if (encoding === 1 || encoding === 2) {
        while (
          offset + 1 < value.length &&
          (value[offset] || value[offset + 1])
        )
          offset += 2;
        offset += 2;
      } else {
        while (offset < value.length && value[offset]) offset++;
        offset++;
      }
      if (["image/jpeg", "image/png"].includes(mime) && offset < value.length)
        result.cover = await new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => resolve(null);
          r.readAsDataURL(new Blob([value.slice(offset)], { type: mime }));
        });
    }
  }
  return result;
}
