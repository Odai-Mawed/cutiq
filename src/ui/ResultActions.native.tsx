import * as Sharing from 'expo-sharing';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import type { CutResult } from '../engine/types';
import type { Theme } from './theme';

export default function ResultActions({ result, theme }: { result: CutResult; theme: Theme }) {
  const share = async () => {
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert('Teilen nicht verfügbar', result.uri);
      return;
    }
    await Sharing.shareAsync(result.uri, { mimeType: result.mime, dialogTitle: result.fileName, UTI: result.mime.startsWith('video') ? 'public.mpeg-4' : 'public.mpeg-4-audio' });
  };
  return (
    <Pressable accessibilityRole="button" onPress={share} style={[styles.button, { backgroundColor: theme.accent }]}>
      <Text style={[styles.buttonText, { color: theme.accentText }]}>Speichern / Teilen</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
});
