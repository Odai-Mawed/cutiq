import type { EngineMessage, ProgressFn } from './types';

type Waiter = {
  match: (m: EngineMessage) => boolean;
  resolve: (m: EngineMessage) => void;
  reject: (e: Error) => void;
  id?: string;
};

/** Small request/response helper on top of the engine's message stream. */
export class EngineBus {
  private ready = false;
  private readyWaiters: Array<() => void> = [];
  private waiters = new Set<Waiter>();
  private progress = new Map<string, ProgressFn>();

  receive(msg: EngineMessage) {
    if (msg.type === 'ready') {
      this.ready = true;
      this.readyWaiters.splice(0).forEach((fn) => fn());
      return;
    }
    if (msg.type === 'progress') {
      this.progress.get(msg.id)?.(msg.stage, msg.ratio);
      return;
    }
    for (const w of [...this.waiters]) {
      if (msg.type === 'error' && (!msg.id || msg.id === w.id)) {
        this.waiters.delete(w);
        w.reject(new Error(msg.message));
      } else if (w.match(msg)) {
        this.waiters.delete(w);
        w.resolve(msg);
      }
    }
  }

  /** Engine page crashed or reloaded: fail everything that is pending. */
  reset(reason: string) {
    this.ready = false;
    for (const w of this.waiters) w.reject(new Error(reason));
    this.waiters.clear();
  }

  whenReady(): Promise<void> {
    return this.ready ? Promise.resolve() : new Promise((r) => this.readyWaiters.push(r));
  }

  onProgress(id: string, fn: ProgressFn | null) {
    if (fn) this.progress.set(id, fn);
    else this.progress.delete(id);
  }

  wait<T extends EngineMessage['type']>(id: string, type: T, seq?: number): Promise<Extract<EngineMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      this.waiters.add({
        id,
        match: (m) => m.type === type && 'id' in m && m.id === id && (seq === undefined || ('seq' in m && m.seq === seq)),
        resolve: resolve as (m: EngineMessage) => void,
        reject,
      });
    });
  }
}

export const newJobId = () => Math.random().toString(36).slice(2, 10);

export function outputName(inputName: string, ext: string) {
  const base = inputName.replace(/\.[^.]+$/, '') || 'video';
  return `${base}-cutiq.${ext}`;
}
