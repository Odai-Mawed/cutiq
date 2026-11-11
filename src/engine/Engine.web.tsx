import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EngineBus, newJobId, outputName } from './bus';
import type { EngineHandle, EngineMessage } from './types';

/** Web: the engine runs in a hidden same-origin iframe. */
const Engine = forwardRef<EngineHandle>(function Engine(_props, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bus = useRef(new EngineBus()).current;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      bus.receive(e.data as EngineMessage);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [bus]);

  useImperativeHandle(ref, () => ({
    async process(input, options, onProgress) {
      if (!input.file) throw new Error('Keine Datei ausgewählt.');
      await bus.whenReady();
      const id = newJobId();
      bus.onProgress(id, onProgress);
      try {
        onProgress('upload', 0);
        const data = await input.file.arrayBuffer();
        const done = bus.wait(id, 'result');
        frame.current!.contentWindow!.postMessage({ type: 'process', id, name: input.name, options, data }, window.location.origin, [data]);
        const r = await done;
        const blob = new Blob([r.data!], { type: r.mime });
        return { uri: URL.createObjectURL(blob), fileName: outputName(input.name, r.ext), mime: r.mime, size: r.size, stats: r.stats };
      } finally {
        bus.onProgress(id, null);
      }
    },
  }));

  return (
    <iframe
      ref={frame}
      src="/engine/index.html"
      title="CutIQ Engine"
      aria-hidden
      style={{ position: 'absolute', width: 0, height: 0, border: 0, visibility: 'hidden' }}
    />
  );
});

export default Engine;
