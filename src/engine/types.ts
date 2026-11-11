export type CutOptions = {
  /** Audio below this level (dBFS) counts as silence. */
  noiseDb: number;
  /** Pauses shorter than this (seconds) are kept. */
  minSilence: number;
  /** Seconds of silence kept around speech so words are not clipped. */
  padding: number;
};

export const DEFAULT_OPTIONS: CutOptions = { noiseDb: -30, minSilence: 0.5, padding: 0.1 };

export type Stage = 'load' | 'upload' | 'analyze' | 'render' | 'download';

export type ProgressFn = (stage: Stage, ratio: number) => void;

export type CutStats = {
  originalDuration: number;
  newDuration: number;
  removedSeconds: number;
  cuts: number;
  segments: number;
};

/** A picked input file. `file` is set on web, `uri` on iOS/Android. */
export type InputMedia = { name: string; size?: number; uri: string; file?: Blob };

export type CutResult = {
  /** blob: URL on web, file:// URI on native */
  uri: string;
  fileName: string;
  mime: string;
  size: number;
  stats: CutStats;
};

export interface EngineHandle {
  process(input: InputMedia, options: CutOptions, onProgress: ProgressFn): Promise<CutResult>;
}

/** Messages sent by the engine page (see public/engine/engine.js). */
export type EngineMessage =
  | { type: 'ready' }
  | { type: 'ack'; id: string; seq: number }
  | { type: 'progress'; id: string; stage: Stage; ratio: number }
  | { type: 'result'; id: string; stats: CutStats; mime: string; ext: string; size: number; data?: ArrayBuffer; chunks?: number }
  | { type: 'result-chunk'; id: string; seq: number; b64: string; done: boolean }
  | { type: 'error'; id?: string; message: string };
