/**
 * Smaller copies of a picked photo or video, made in the browser before
 * upload, so the feed doesn't download full-size originals:
 *
 * - display: 1280px on the long edge, for the feed and post pages
 * - thumb: 400px, for small previews
 *
 * For a video, both come from its first frame, and the feed shows that as the
 * poster: nothing of the video downloads until someone presses play.
 * Everything is JPEG: Safari can't reliably encode WebP from a canvas.
 * Any failure (an undecodable HEIC in Chrome, a video codec the browser can't
 * play) resolves to null, and the post simply shows the original.
 */

const DISPLAY_EDGE = 1280;
const THUMB_EDGE = 400;
const DISPLAY_QUALITY = 0.82;
const THUMB_QUALITY = 0.75;
// Just past 0: the first frame, without relying on a seek to where the video already is
const VIDEO_FRAME_AT = 0.1;
// Past this, a phone may refuse to allocate the canvas (iOS caps canvases around 16.7M pixels)
const MAX_CANVAS_PIXELS = 16_000_000;
const VIDEO_TIMEOUT_MS = 8_000;
// A stuck file mustn't hold up the queue, or the post waiting on it
const FILE_TIMEOUT_MS = 30_000;

export type Derivatives = { display: File; thumb: File; width: number; height: number };

// One file at a time: decoding a 24–48 MP photo takes hundreds of MB, and several at once can crash a phone's tab
let queue: Promise<unknown> = Promise.resolve();

export function makeDerivatives(file: File): Promise<Derivatives | null> {
  const make = () => (file.type.startsWith("video/") ? fromVideo(file) : fromImage(file));
  const run = queue.then(() => withTimeout(make(), FILE_TIMEOUT_MS)).catch((e: unknown) => {
    console.warn("[media] couldn't make smaller copies, the original will be shown", e);
    return null;
  });
  queue = run;
  return run;
}

async function fromImage(file: File) {
  const url = URL.createObjectURL(file);
  try {
    // Browsers apply the photo's EXIF orientation to <img>, and to drawing it on a canvas.
    // The load event rather than img.decode(): Chrome never settles decode() while the page is hidden.
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image didn't decode")); // e.g. HEIC outside Safari
      el.src = url;
    });
    return await encode(img, img.naturalWidth, img.naturalHeight, file.name);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fromVideo(file: File) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  try {
    video.src = url;
    video.load();
    await waitFor(video, "loadedmetadata");
    // An unknown length (Infinity, e.g. some WebM) still aims for the first frame; a very short clip uses its middle
    const at = video.duration > VIDEO_FRAME_AT || !Number.isFinite(video.duration) ? VIDEO_FRAME_AT : video.duration / 2;
    try {
      await seek(video, at);
    } catch {
      // Some iOS versions won't decode frames for a video that has never played; a muted play unlocks it
      await video.play().catch(() => {});
      video.pause();
      await seek(video, at);
    }
    // Give the decoder a moment to paint the seeked picture (not rAF, which never fires while hidden)
    await new Promise((r) => setTimeout(r, 50));
    return await encode(video, video.videoWidth, video.videoHeight, file.name);
  } finally {
    video.removeAttribute("src");
    video.load(); // lets go of the decoder
    URL.revokeObjectURL(url);
  }
}

/**
 * A square JPEG of a photo, center-cropped, `edge` px on each side: for
 * avatars (player photos), which are always shown as squares. Unlike
 * makeDerivatives this throws when the photo can't be read (e.g. HEIC outside
 * Safari), so the caller can say so instead of uploading an original.
 */
export function makeSquareJpeg(file: File, edge: number, quality = 0.82): Promise<File> {
  const run = queue.then(() =>
    withTimeout(
      (async () => {
        const url = URL.createObjectURL(file);
        try {
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error("That photo couldn't be read. Try a JPG or PNG."));
            el.src = url;
          });
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          if (!w || !h) throw new Error("That photo couldn't be read. Try a JPG or PNG.");
          // Scale so the short side is `edge` (or smaller, for a small photo), then crop the middle
          const short = Math.min(w, h);
          const scaled = scaleDown(img, w, h, Math.round(Math.max(w, h) * Math.min(1, edge / short)));
          try {
            const side = Math.min(scaled.width, scaled.height);
            const square = document.createElement("canvas");
            square.width = side;
            square.height = side;
            const ctx = square.getContext("2d");
            if (!ctx) throw new Error("no 2d canvas");
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, side, side);
            ctx.drawImage(scaled, (scaled.width - side) / 2, (scaled.height - side) / 2, side, side, 0, 0, side, side);
            try {
              const base = file.name.replace(/\.[^.]*$/, "") || "photo";
              return new File([await toJpeg(square, quality)], `${base}-${side}.jpg`, { type: "image/jpeg" });
            } finally {
              release(square);
            }
          } finally {
            release(scaled);
          }
        } finally {
          URL.revokeObjectURL(url);
        }
      })(),
      FILE_TIMEOUT_MS
    )
  );
  // Keep the queue going even when this one fails
  queue = run.catch(() => null);
  return run;
}

function seek(video: HTMLVideoElement, at: number) {
  const seeked = waitFor(video, "seeked");
  video.currentTime = at;
  return seeked;
}

function waitFor(video: HTMLVideoElement, event: "loadedmetadata" | "seeked") {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => done(new Error(`video ${event} timed out`)), VIDEO_TIMEOUT_MS);
    const done = (err?: unknown) => {
      window.clearTimeout(timer);
      video.removeEventListener(event, ok);
      video.removeEventListener("error", fail);
      if (err) reject(err);
      else resolve();
    };
    const ok = () => done();
    const fail = () => done(video.error ?? new Error("video failed to load"));
    video.addEventListener(event, ok);
    video.addEventListener("error", fail);
  });
}

async function encode(source: CanvasImageSource, width: number, height: number, name: string): Promise<Derivatives> {
  if (!width || !height) throw new Error("source has no size");
  const display = scaleDown(source, width, height, DISPLAY_EDGE);
  try {
    const thumb = scaleDown(display, display.width, display.height, THUMB_EDGE);
    try {
      const base = name.replace(/\.[^.]*$/, "") || "media";
      return {
        display: new File([await toJpeg(display, DISPLAY_QUALITY)], `${base}-1280.jpg`, { type: "image/jpeg" }),
        thumb: new File([await toJpeg(thumb, THUMB_QUALITY)], `${base}-400.jpg`, { type: "image/jpeg" }),
        width: display.width,
        height: display.height,
      };
    } finally {
      release(thumb);
    }
  } finally {
    release(display);
  }
}

/**
 * Fits `source` within `maxEdge`, halving in steps on the way down: one big
 * jump in a canvas skips most of the source pixels and looks jagged.
 */
function scaleDown(source: CanvasImageSource, width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const target = { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };

  let current: CanvasImageSource = source;
  let w = width;
  let h = height;
  let step: HTMLCanvasElement | null = null;
  while (w / 2 > target.w && h / 2 > target.h) {
    let nw = Math.round(w / 2);
    let nh = Math.round(h / 2);
    // A huge photo's first step can still be too big for a phone's canvas; shrink it more
    if (nw * nh > MAX_CANVAS_PIXELS) {
      const fit = Math.sqrt(MAX_CANVAS_PIXELS / (nw * nh));
      nw = Math.max(target.w, Math.floor(nw * fit));
      nh = Math.max(target.h, Math.floor(nh * fit));
    }
    const next = draw(current, nw, nh);
    if (step) release(step);
    step = next;
    current = next;
    w = nw;
    h = nh;
  }
  const out = draw(current, target.w, target.h);
  if (step) release(step);
  return out;
}

function draw(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  // JPEG has no transparency; without this a transparent PNG turns black
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function toJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas encode failed"))), "image/jpeg", quality),
  );
}

function withTimeout<T>(work: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timed out")), ms);
    work.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

/** iOS Safari holds canvas memory until the canvas is shrunk, not just when it's unreferenced. */
function release(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}
