// CutIQ processing engine. Runs ffmpeg.wasm in a page that is embedded
// as a hidden <iframe> (web) or <WebView> (iOS/Android).
//
// Protocol (all messages are plain objects with a `type`):
//  host -> engine
//    { type:'process', id, name, options, data:ArrayBuffer }       (web)
//    { type:'begin', id, name, size, options }                     (native upload)
//    { type:'chunk', id, seq, b64 }  -> engine answers { type:'ack', id, seq }
//    { type:'end', id }              -> starts processing
//    { type:'pull', id, seq }        -> engine answers { type:'result-chunk', id, seq, b64, done }
//    { type:'cancel', id }
//  engine -> host
//    { type:'ready' }
//    { type:'progress', id, stage:'load'|'analyze'|'render', ratio }
//    { type:'result', id, stats, mime, ext, size, data? }  (data only for web)
//    { type:'error', id, message }

import { FFmpeg } from './vendor/ffmpeg/index.js';
import {
  parseAnalysisLog,
  computeKeepSegments,
  buildFilterGraph,
  totalLength,
  parseProgressTime,
} from './silence.js';

const CHUNK = 768 * 1024; // raw bytes per native transfer chunk (~1 MB base64)
const isNative = () => typeof window.ReactNativeWebView !== 'undefined';

// ---------- transport ----------
function send(msg, transfer) {
  if (isNative()) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  } else if (window.parent !== window) {
    window.parent.postMessage(msg, location.origin, transfer || []);
  }
}

window.__cutiqReceive = (msg) => handle(typeof msg === 'string' ? JSON.parse(msg) : msg);
window.addEventListener('message', (e) => {
  if (isNative() || e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
  handle(e.data);
});

// ---------- base64 (native transport) ----------
function toB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
function fromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- ffmpeg ----------
let ffmpeg = null;
let loading = null;
let logSink = null;

async function getFFmpeg(id) {
  if (ffmpeg) return ffmpeg;
  if (!loading) {
    loading = (async () => {
      const f = new FFmpeg();
      f.on('log', ({ message }) => logSink && logSink(message));
      const base = new URL('./vendor/core/', location.href).href;
      await f.load({ coreURL: base + 'ffmpeg-core.js', wasmURL: base + 'ffmpeg-core.wasm' });
      ffmpeg = f;
      return f;
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  send({ type: 'progress', id, stage: 'load', ratio: 0 });
  return loading;
}

async function run(f, args, onLine) {
  logSink = onLine;
  try {
    const code = await f.exec(args);
    return code;
  } finally {
    logSink = null;
  }
}

const jobs = new Map(); // id -> { name, size, options, parts:[], received, result }

async function processJob(id, name, bytes, options) {
  const opts = {
    noiseDb: clamp(Number(options?.noiseDb ?? -30), -80, -5),
    minSilence: clamp(Number(options?.minSilence ?? 0.5), 0.1, 10),
    padding: clamp(Number(options?.padding ?? 0.1), 0, 2),
  };
  const f = await getFFmpeg(id);
  const inExt = (/\.([a-z0-9]{1,5})$/i.exec(name || '')?.[1] || 'mp4').toLowerCase();
  const input = `in_${id}.${inExt}`;
  await f.writeFile(input, bytes);
  bytes = null;

  try {
    // 1) analyse: find silences
    const lines = [];
    let duration = NaN;
    send({ type: 'progress', id, stage: 'analyze', ratio: 0 });
    await run(
      f,
      ['-hide_banner', '-i', input, '-vn', '-af', `silencedetect=noise=${opts.noiseDb}dB:d=${opts.minSilence}`, '-f', 'null', '-'],
      (line) => {
        lines.push(line);
        if (Number.isNaN(duration)) duration = parseAnalysisLog([line]).duration;
        const t = parseProgressTime(line);
        if (t >= 0 && duration > 0) send({ type: 'progress', id, stage: 'analyze', ratio: Math.min(1, t / duration) });
      },
    );
    const info = parseAnalysisLog(lines);
    if (!info.hasAudio) throw new Error('Die Datei hat keine Tonspur – Stille kann nicht erkannt werden.');
    if (!(info.duration > 0)) throw new Error('Dauer der Datei konnte nicht gelesen werden.');

    const segments = computeKeepSegments(info.silences, info.duration, { padding: opts.padding });
    if (!segments.length) throw new Error('Die ganze Datei ist still. Versuche einen niedrigeren Schwellwert (z. B. -40 dB).');
    const newDuration = totalLength(segments);
    const stats = {
      originalDuration: round(info.duration),
      newDuration,
      removedSeconds: round(info.duration - newDuration),
      cuts: info.silences.length,
      segments: segments.length,
    };

    // 2) render: keep only the non-silent parts
    const ext = info.hasVideo ? 'mp4' : 'm4a';
    const mime = info.hasVideo ? 'video/mp4' : 'audio/mp4';
    const output = `out_${id}.${ext}`;
    const graph = buildFilterGraph(segments, info);
    const args = ['-hide_banner', '-i', input, '-filter_complex', graph];
    if (info.hasVideo) args.push('-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-vsync', 'vfr');
    args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output);

    send({ type: 'progress', id, stage: 'render', ratio: 0 });
    const renderLog = [];
    const code = await run(f, args, (line) => {
      renderLog.push(line);
      const t = parseProgressTime(line);
      if (t >= 0) send({ type: 'progress', id, stage: 'render', ratio: Math.min(1, t / newDuration) });
    });
    if (code !== 0) {
      console.error(renderLog.join('\n'));
      throw new Error('Rendern fehlgeschlagen (ffmpeg Code ' + code + ').');
    }
    const data = await f.readFile(output);
    await f.deleteFile(output).catch(() => {});
    return { stats, mime, ext, data };
  } finally {
    await f.deleteFile(input).catch(() => {});
  }
}

async function handle(msg) {
  const { type, id } = msg;
  try {
    if (type === 'process') {
      const r = await processJob(id, msg.name, new Uint8Array(msg.data), msg.options);
      send({ type: 'result', id, stats: r.stats, mime: r.mime, ext: r.ext, size: r.data.byteLength, data: r.data.buffer }, [r.data.buffer]);
    } else if (type === 'begin') {
      jobs.set(id, { name: msg.name, size: msg.size, options: msg.options, parts: [], received: 0 });
      send({ type: 'ack', id, seq: -1 });
    } else if (type === 'chunk') {
      const job = jobs.get(id);
      if (!job) throw new Error('Unbekannter Auftrag');
      const part = fromB64(msg.b64);
      job.parts.push(part);
      job.received += part.length;
      send({ type: 'ack', id, seq: msg.seq });
    } else if (type === 'end') {
      const job = jobs.get(id);
      if (!job) throw new Error('Unbekannter Auftrag');
      const bytes = new Uint8Array(job.received);
      let o = 0;
      for (const p of job.parts) { bytes.set(p, o); o += p.length; }
      job.parts = [];
      const r = await processJob(id, job.name, bytes, job.options);
      job.result = r.data;
      send({ type: 'result', id, stats: r.stats, mime: r.mime, ext: r.ext, size: r.data.byteLength, chunks: Math.ceil(r.data.byteLength / CHUNK) });
    } else if (type === 'pull') {
      const job = jobs.get(id);
      if (!job?.result) throw new Error('Kein Ergebnis vorhanden');
      const start = msg.seq * CHUNK;
      const end = Math.min(job.result.byteLength, start + CHUNK);
      const done = end >= job.result.byteLength;
      send({ type: 'result-chunk', id, seq: msg.seq, b64: toB64(job.result.subarray(start, end)), done });
      if (done) jobs.delete(id);
    } else if (type === 'cancel') {
      jobs.delete(id);
    }
  } catch (err) {
    jobs.delete(id);
    send({ type: 'error', id, message: err?.message || String(err) });
  }
}

const clamp = (n, lo, hi) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);
const round = (n) => Math.round(n * 100) / 100;

send({ type: 'ready' });
