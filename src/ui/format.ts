export const fmtSeconds = (s: number) => {
  if (!Number.isFinite(s)) return '–';
  if (s < 60) return `${s.toFixed(1).replace('.', ',')} s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, '0')} min`;
};

export const fmtBytes = (b?: number) => {
  if (!b) return '';
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
};
