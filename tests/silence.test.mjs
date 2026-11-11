import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTimestamp,
  parseAnalysisLog,
  computeKeepSegments,
  buildFilterGraph,
  totalLength,
  parseProgressTime,
} from '../public/engine/silence.js';

test('parseTimestamp', () => {
  assert.equal(parseTimestamp('00:01:02.50'), 62.5);
  assert.equal(parseTimestamp('01:00:00'), 3600);
  assert.ok(Number.isNaN(parseTimestamp('nope')));
});

test('parseAnalysisLog reads duration, streams and silences', () => {
  const log = [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'input.mp4':",
    '  Duration: 00:00:10.00, start: 0.000000, bitrate: 1000 kb/s',
    '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1280x720',
    '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo',
    'Output #0, null, to \'pipe:\':',
    '  Stream #0:0: Audio: pcm_s16le, 44100 Hz, stereo',
    '[silencedetect @ 0x1] silence_start: 0',
    '[silencedetect @ 0x1] silence_end: 1.5 | silence_duration: 1.5',
    '[silencedetect @ 0x1] silence_start: 4.2',
    '[silencedetect @ 0x1] silence_end: 6 | silence_duration: 1.8',
    '[silencedetect @ 0x1] silence_start: 9.1',
  ];
  const r = parseAnalysisLog(log);
  assert.equal(r.duration, 10);
  assert.equal(r.hasVideo, true);
  assert.equal(r.hasAudio, true);
  assert.deepEqual(r.silences, [[0, 1.5], [4.2, 6], [9.1, 10]]);
});

test('parseAnalysisLog: audio-only file has no video', () => {
  const r = parseAnalysisLog([
    '  Duration: 00:00:03.00, start: 0.000000',
    '  Stream #0:0: Audio: mp3, 44100 Hz',
    'Output #0, null',
    '  Stream #0:0: Video: wrapped_avframe', // must be ignored
  ]);
  assert.equal(r.hasVideo, false);
  assert.equal(r.hasAudio, true);
});

test('computeKeepSegments inverts silences with padding', () => {
  const keep = computeKeepSegments([[0, 1.5], [4.2, 6], [9.1, 10]], 10, { padding: 0.1 });
  // start/end silences are cut fully, inner silence keeps 0.1s on each side
  assert.deepEqual(keep, [[1.4, 4.3], [5.9, 9.2]]);
});

test('computeKeepSegments: start silence cut from 0, no silences keeps everything', () => {
  assert.deepEqual(computeKeepSegments([], 5), [[0, 5]]);
  const keep = computeKeepSegments([[0, 2]], 5, { padding: 0.2 });
  assert.deepEqual(keep, [[1.8, 5]]);
});

test('computeKeepSegments merges overlapping cuts and drops tiny pieces', () => {
  const keep = computeKeepSegments([[1, 3], [3.02, 5]], 6, { padding: 0, minKeep: 0.05 });
  assert.deepEqual(keep, [[0, 1], [5, 6]]);
});

test('computeKeepSegments: short silence fully absorbed by padding is ignored', () => {
  assert.deepEqual(computeKeepSegments([[2, 2.15]], 4, { padding: 0.1 }), [[0, 4]]);
});

test('buildFilterGraph builds select + offset expression', () => {
  const g = buildFilterGraph([[1, 2], [4, 5]], { hasVideo: true, hasAudio: true });
  assert.equal(
    g,
    "[0:v]select='between(t,1,2)+between(t,4,5)',setpts='(T-(1*gte(T,1)+2*gte(T,4)))/TB'[v];" +
      "[0:a]aselect='between(t,1,2)+between(t,4,5)',asetpts=N/SR/TB[a]",
  );
  assert.equal(totalLength([[1, 2], [4, 5]]), 2);
});

test('buildFilterGraph audio only, segment starting at 0', () => {
  const g = buildFilterGraph([[0, 2], [3, 4]], { hasVideo: false, hasAudio: true });
  assert.equal(g, "[0:a]aselect='between(t,0,2)+between(t,3,4)',asetpts=N/SR/TB[a]");
  assert.throws(() => buildFilterGraph([], { hasVideo: true, hasAudio: true }));
});

test('parseProgressTime', () => {
  assert.equal(parseProgressTime('frame=  100 fps=30 size=  256kB time=00:00:03.33 bitrate=...'), 3.33);
  assert.ok(Number.isNaN(parseProgressTime('foo')));
});
