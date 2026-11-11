import { useColorScheme } from 'react-native';

const light = {
  bg: '#F5F5F7',
  card: '#FFFFFF',
  text: '#16161A',
  muted: '#6B6B76',
  border: '#E3E3E8',
  accent: '#5B4BFF',
  accentText: '#FFFFFF',
  chip: '#EFEFF4',
  danger: '#C62828',
  success: '#1B7F4B',
};
const dark: typeof light = {
  bg: '#0E0E12',
  card: '#18181F',
  text: '#F2F2F5',
  muted: '#9A9AA6',
  border: '#2A2A33',
  accent: '#7D70FF',
  accentText: '#FFFFFF',
  chip: '#23232C',
  danger: '#FF6B6B',
  success: '#4CD38A',
};

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);
