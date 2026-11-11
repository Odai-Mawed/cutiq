import * as DocumentPicker from 'expo-document-picker';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Engine from './engine/Engine';
import { DEFAULT_OPTIONS, type CutOptions, type CutResult, type EngineHandle, type InputMedia, type Stage } from './engine/types';
import { fmtBytes, fmtSeconds } from './ui/format';
import ResultActions from './ui/ResultActions';
import { useTheme, type Theme } from './ui/theme';

const STAGE_LABEL: Record<Stage, string> = {
  load: 'Schnitt-Engine wird geladen (einmalig ~30 MB) …',
  upload: 'Datei wird vorbereitet …',
  analyze: 'Stille wird erkannt …',
  render: 'Video wird geschnitten …',
  download: 'Ergebnis wird gespeichert …',
};

const PRESETS = {
  noiseDb: { label: 'Stille-Schwelle', hint: 'Alles leiser als dieser Pegel gilt als Stille. Bei Hintergrundrauschen höher wählen.', values: [-45, -40, -35, -30, -25, -20], fmt: (v: number) => `${v} dB` },
  minSilence: { label: 'Mindestlänge einer Pause', hint: 'Kürzere Pausen bleiben drin, damit es natürlich klingt.', values: [0.3, 0.5, 0.75, 1, 1.5, 2], fmt: (v: number) => `${String(v).replace('.', ',')} s` },
  padding: { label: 'Puffer um Sprache', hint: 'So viel Stille bleibt vor und nach jedem Satz stehen.', values: [0, 0.05, 0.1, 0.2, 0.3], fmt: (v: number) => `${String(v).replace('.', ',')} s` },
} as const;

type Status = { kind: 'idle' } | { kind: 'working'; stage: Stage; ratio: number } | { kind: 'done'; result: CutResult } | { kind: 'error'; message: string };

export default function CutScreen() {
  const t = useTheme();
  const engine = useRef<EngineHandle>(null);
  const [media, setMedia] = useState<InputMedia | null>(null);
  const [options, setOptions] = useState<CutOptions>(DEFAULT_OPTIONS);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const working = status.kind === 'working';

  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ['video/*', 'audio/*'], copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    if (status.kind === 'done' && Platform.OS === 'web') URL.revokeObjectURL(status.result.uri);
    setMedia({ name: a.name, size: a.size, uri: a.uri, file: a.file });
    setStatus({ kind: 'idle' });
  };

  const run = async () => {
    if (!media || !engine.current) return;
    setStatus({ kind: 'working', stage: 'load', ratio: 0 });
    try {
      const result = await engine.current.process(media, options, (stage, ratio) => setStatus({ kind: 'working', stage, ratio }));
      setStatus({ kind: 'done', result });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <StatusBar style="auto" />
      <Engine ref={engine} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.inner}>
          <Text style={[styles.title, { color: t.text }]}>CutIQ</Text>
          <Text style={[styles.subtitle, { color: t.muted }]}>Video rein, Pausen raus. Alle stillen Stellen werden automatisch herausgeschnitten – direkt auf deinem Gerät, nichts wird hochgeladen.</Text>

          <Card t={t}>
            <Step n={1} t={t} title="Video auswählen" />
            <Pressable accessibilityRole="button" disabled={working} onPress={pick} style={[styles.drop, { borderColor: t.border, backgroundColor: t.chip, opacity: working ? 0.5 : 1 }]}>
              {media ? (
                <>
                  <Text style={[styles.fileName, { color: t.text }]} numberOfLines={1}>{media.name}</Text>
                  <Text style={{ color: t.muted }}>{fmtBytes(media.size)} · Tippen zum Ändern</Text>
                </>
              ) : (
                <>
                  <Text style={[styles.fileName, { color: t.accent }]}>+ Video oder Audio wählen</Text>
                  <Text style={{ color: t.muted }}>MP4, MOV, WebM, MP3, M4A …</Text>
                </>
              )}
            </Pressable>
          </Card>

          <Card t={t}>
            <Step n={2} t={t} title="Einstellungen" />
            {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((key) => {
              const p = PRESETS[key];
              return (
                <View key={key} style={{ gap: 8 }}>
                  <Text style={[styles.label, { color: t.text }]}>{p.label}</Text>
                  <View style={styles.chips}>
                    {p.values.map((v) => {
                      const active = options[key] === v;
                      return (
                        <Pressable
                          key={v}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          disabled={working}
                          onPress={() => setOptions((o) => ({ ...o, [key]: v }))}
                          style={[styles.chip, { backgroundColor: active ? t.accent : t.chip }]}
                        >
                          <Text style={{ color: active ? t.accentText : t.text, fontWeight: active ? '600' : '400' }}>{p.fmt(v)}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={[styles.hint, { color: t.muted }]}>{p.hint}</Text>
                </View>
              );
            })}
          </Card>

          <Card t={t}>
            <Step n={3} t={t} title="Stille entfernen" />
            <Pressable
              accessibilityRole="button"
              disabled={!media || working}
              onPress={run}
              style={[styles.primary, { backgroundColor: t.accent, opacity: !media || working ? 0.5 : 1 }]}
            >
              {working ? <ActivityIndicator color={t.accentText} /> : <Text style={[styles.primaryText, { color: t.accentText }]}>Leerstellen rausschneiden</Text>}
            </Pressable>

            {status.kind === 'working' && (
              <View style={{ gap: 8 }}>
                <Text style={{ color: t.text }}>{STAGE_LABEL[status.stage]}</Text>
                <View style={[styles.track, { backgroundColor: t.chip }]}>
                  <View style={[styles.bar, { backgroundColor: t.accent, width: `${Math.round(Math.max(0.03, status.ratio) * 100)}%` }]} />
                </View>
              </View>
            )}

            {status.kind === 'error' && <Text style={{ color: t.danger }}>{status.message}</Text>}

            {status.kind === 'done' && (
              <View style={{ gap: 12 }}>
                <View style={styles.stats}>
                  <Stat t={t} label="Vorher" value={fmtSeconds(status.result.stats.originalDuration)} />
                  <Stat t={t} label="Nachher" value={fmtSeconds(status.result.stats.newDuration)} />
                  <Stat t={t} label="Entfernt" value={fmtSeconds(status.result.stats.removedSeconds)} accent={t.success} />
                </View>
                <Text style={{ color: t.muted }}>
                  {status.result.stats.cuts === 0
                    ? 'Keine Pausen gefunden – probiere eine höhere Stille-Schwelle.'
                    : `${status.result.stats.cuts} Pausen entfernt · ${fmtBytes(status.result.size)}`}
                </Text>
                <ResultActions result={status.result} theme={t} />
              </View>
            )}
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

function Card({ t, children }: { t: Theme; children: React.ReactNode }) {
  return <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>{children}</View>;
}

function Step({ n, title, t }: { n: number; title: string; t: Theme }) {
  return (
    <View style={styles.step}>
      <View style={[styles.stepNum, { backgroundColor: t.accent }]}>
        <Text style={{ color: t.accentText, fontWeight: '700' }}>{n}</Text>
      </View>
      <Text style={[styles.stepTitle, { color: t.text }]}>{title}</Text>
    </View>
  );
}

function Stat({ t, label, value, accent }: { t: Theme; label: string; value: string; accent?: string }) {
  return (
    <View style={[styles.stat, { backgroundColor: t.chip }]}>
      <Text style={{ color: t.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: accent ?? t.text, fontSize: 20, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: Platform.OS === 'web' ? 40 : 64, paddingBottom: 48 },
  inner: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 16 },
  title: { fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 16, lineHeight: 22 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 16 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { fontSize: 18, fontWeight: '700' },
  drop: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 24, paddingHorizontal: 16, alignItems: 'center', gap: 4 },
  fileName: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  primary: { borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  primaryText: { fontSize: 17, fontWeight: '700' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, borderRadius: 12, padding: 12, gap: 2 },
});
