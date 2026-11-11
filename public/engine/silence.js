// Pure helpers for silence removal. No browser / ffmpeg dependencies,
// so they can be unit-tested with `node --test`.

/** Parse "HH:MM:SS.xx" into seconds. */
export function parseTimestamp(ts) {
  const m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(ts.trim());
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Extract media info and detected silences from ffmpeg log output of a
 * `-af silencedetect` run.
 * @param {string[]} lines
 */
export function parseAnalysisLog(lines) {
  let duration = NaN;
  let hasVideo = false;
  let hasAudio = false;
  const silences = [];
  let openStart = null;
  let inOutput = false;

  for (const line of lines) {
    const d = /Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(line);
    if (d && Number.isNaN(duration)) duration = parseTimestamp(d[1]);

    // Only count input streams: the `-f null` output lists streams too.
    if (/^\s*Output #\d/.test(line)) inOutput = true;
    if (!inOutput && /Stream #0:\d+.*?: Video:/.test(line) && !/attached pic/.test(line)) hasVideo = true;
    if (!inOutput && /Stream #0:\d+.*?: Audio:/.test(line)) hasAudio = true;

    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) openStart = Math.max(0, Number(s[1]));
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (e) {
      silences.push([openStart ?? 0, Number(e[1])]);
      openStart = null;
    }
  }
  // Silence that lasts until the end of the file has no silence_end.
  if (openStart !== null && !Number.isNaN(duration)) silences.push([openStart, duration]);

  return { duration, hasVideo, hasAudio, silences };
}

/**
 * Turn silences into the segments that should be kept.
 * @param {Array<[number, number]>} silences
 * @param {number} duration total media duration in seconds
 * @param {{ padding?: number, minKeep?: number }} opts
 *   padding: seconds of silence kept before/after speech (avoids clipped words)
 *   minKeep: kept segments shorter than this are dropped (clicks, breaths)
 * @returns {Array<[number, number]>}
 */
export function computeKeepSegments(silences, duration, opts = {}) {
  const padding = Math.max(0, opts.padding ?? 0.1);
  const minKeep = Math.max(0, opts.minKeep ?? 0.05);
  const eps = 0.01;

  const cuts = silences
    .map(([s, e]) => [Math.max(0, s), Math.min(duration, e)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0])
    .map(([s, e]) => [
      s <= eps ? 0 : s + padding, // no padding needed at the very start
      e >= duration - eps ? duration : e - padding, // or at the very end
    ])
    .filter(([s, e]) => e - s > eps);

  const keep = [];
  let cursor = 0;
  for (const [s, e] of cuts) {
    if (s > cursor) keep.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < duration) keep.push([cursor, duration]);

  return keep.filter(([s, e]) => e - s >= minKeep).map(([s, e]) => [round(s), round(e)]);
}

const round = (n) => Math.round(n * 1000) / 1000;

/**
 * Build an ffmpeg -filter_complex graph that keeps only `segments`.
 * Uses select/aselect (single streaming pass, constant memory) and rebuilds
 * timestamps by subtracting the time removed before each segment, so the
 * result stays in sync even for variable-frame-rate phone videos.
 */
export function buildFilterGraph(segments, { hasVideo, hasAudio }) {
  if (!segments.length) throw new Error('No segments to keep');
  const between = segments.map(([s, e]) => `between(t,${s},${e})`).join('+');

  // offset(T) = time removed before the segment T belongs to, written as a sum
  // of steps: removed_i - removed_{i-1} applied once T >= start_i.
  let removed = 0;
  let kept = 0;
  const steps = [];
  for (const [s, e] of segments) {
    const removedHere = s - kept;
    const delta = round(removedHere - removed);
    if (delta > 0) steps.push(`${delta}*gte(T,${s})`);
    removed = removedHere;
    kept += e - s;
  }
  const offset = steps.length ? steps.join('+') : '0';

  const parts = [];
  if (hasVideo) parts.push(`[0:v]select='${between}',setpts='(T-(${offset}))/TB'[v]`);
  if (hasAudio) parts.push(`[0:a]aselect='${between}',asetpts=N/SR/TB[a]`);
  return parts.join(';');
}

/** Total length of all segments in seconds. */
export function totalLength(segments) {
  return round(segments.reduce((sum, [s, e]) => sum + (e - s), 0));
}

/** Read the last `time=HH:MM:SS.xx` from an ffmpeg progress line. */
export function parseProgressTime(line) {
  const m = /time=\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(line);
  return m ? parseTimestamp(m[1]) : NaN;
}
