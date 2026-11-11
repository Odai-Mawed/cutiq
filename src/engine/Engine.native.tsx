import { File, FileMode, Paths } from 'expo-file-system';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
import type { ComponentType, Ref } from 'react';
import { decodeBase64, encodeBase64 } from './base64';
import { EngineBus, newJobId, outputName } from './bus';
import { ENGINE_URL } from './config';
import type { EngineHandle, EngineMessage } from './types';

const CHUNK = 768 * 1024; // must match engine.js

// react-native-webview's prop types currently collapse to `never` with the
// React Native 0.88 typings, so declare the subset we use.
type WebViewInstance = { injectJavaScript(js: string): void; reload(): void };
type MessageEvent = { nativeEvent: { data: string } };
type ErrorEvent = { nativeEvent: { description: string } };
const WebView = RNWebView as unknown as ComponentType<{
  ref?: Ref<WebViewInstance>;
  source: { uri: string };
  originWhitelist?: string[];
  javaScriptEnabled?: boolean;
  onMessage?: (e: MessageEvent) => void;
  onLoadStart?: () => void;
  onError?: (e: ErrorEvent) => void;
  onContentProcessDidTerminate?: () => void;
  onRenderProcessGone?: () => void;
}>;

/**
 * iOS/Android: the engine page (hosted with the web build on Netlify) runs in
 * an invisible WebView. Files are streamed in base64 chunks with acks so
 * neither side has to hold a huge string in memory.
 */
const Engine = forwardRef<EngineHandle>(function Engine(_props, ref) {
  const web = useRef<WebViewInstance>(null);
  const bus = useRef(new EngineBus()).current;

  const post = (msg: object) => {
    web.current?.injectJavaScript(`window.__cutiqReceive && window.__cutiqReceive(${JSON.stringify(JSON.stringify(msg))});true;`);
  };

  useImperativeHandle(ref, () => ({
    async process(input, options, onProgress) {
      await bus.whenReady();
      const id = newJobId();
      bus.onProgress(id, onProgress);
      try {
        // upload
        const src = new File(input.uri);
        const size = input.size ?? src.size ?? 0;
        const reader = src.open(FileMode.ReadOnly);
        try {
          let ack = bus.wait(id, 'ack', -1);
          post({ type: 'begin', id, name: input.name, size, options });
          await ack;
          let seq = 0;
          let sent = 0;
          onProgress('upload', 0);
          for (;;) {
            const bytes = await reader.readBytes(CHUNK);
            if (!bytes.length) break;
            ack = bus.wait(id, 'ack', seq);
            post({ type: 'chunk', id, seq, b64: encodeBase64(bytes) });
            await ack;
            sent += bytes.length;
            seq++;
            onProgress('upload', size ? sent / size : 0);
          }
        } finally {
          reader.close();
        }

        // process
        const result = bus.wait(id, 'result');
        post({ type: 'end', id });
        const r = await result;

        // download
        const fileName = outputName(input.name, r.ext);
        const out = new File(Paths.cache, `${Date.now()}-${fileName}`);
        out.create({ overwrite: true });
        const writer = out.open(FileMode.WriteOnly);
        try {
          const chunks = r.chunks ?? 0;
          for (let seq = 0; seq < chunks; seq++) {
            const next = bus.wait(id, 'result-chunk', seq);
            post({ type: 'pull', id, seq });
            const c = await next;
            await writer.writeBytes(decodeBase64(c.b64));
            onProgress('download', (seq + 1) / chunks);
          }
        } finally {
          writer.close();
        }
        return { uri: out.uri, fileName, mime: r.mime, size: r.size, stats: r.stats };
      } catch (e) {
        post({ type: 'cancel', id });
        throw e;
      } finally {
        bus.onProgress(id, null);
      }
    },
  }));

  const crashed = () => {
    bus.reset('Die Verarbeitung ist abgestürzt (zu wenig Speicher?). Bitte mit einem kürzeren Video erneut versuchen.');
    web.current?.reload();
  };

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={web}
        source={{ uri: ENGINE_URL }}
        originWhitelist={['https://*', 'http://*']}
        javaScriptEnabled
        onMessage={(e) => bus.receive(JSON.parse(e.nativeEvent.data) as EngineMessage)}
        onLoadStart={() => bus.reset('Engine wurde neu geladen.')}
        onError={(e) => bus.reset(`Engine konnte nicht geladen werden: ${e.nativeEvent.description}`)}
        onContentProcessDidTerminate={crashed}
        onRenderProcessGone={crashed}
      />
    </View>
  );
});

const styles = StyleSheet.create({ hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' } });

export default Engine;
