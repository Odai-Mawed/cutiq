import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CutResult } from '../engine/types';
import type { Theme } from './theme';

export default function ResultActions({ result, theme }: { result: CutResult; theme: Theme }) {
  const isVideo = result.mime.startsWith('video');
  return (
    <View style={{ gap: 12 }}>
      {isVideo ? (
        <video src={result.uri} controls playsInline style={{ width: '100%', maxHeight: 420, borderRadius: 12, background: '#000' }} />
      ) : (
        <audio src={result.uri} controls style={{ width: '100%' }} />
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          const a = document.createElement('a');
          a.href = result.uri;
          a.download = result.fileName;
          a.click();
        }}
        style={[styles.button, { backgroundColor: theme.accent }]}
      >
        <Text style={[styles.buttonText, { color: theme.accentText }]}>Herunterladen</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
});
