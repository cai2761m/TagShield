import type { Settings } from '../types';
export const DEFAULT_SETTINGS: Settings = {
  mode: 'safe', escapeStyle: 'backslash', autoThreshold: 0.98,
  ignoredTags: [], retentionDays: 30, retentionCount: 100,
};
export function readSettings(value: unknown): Settings {
  const data = (value && typeof value === 'object' ? value : {}) as Partial<Settings>;
  const number = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
  return {
    mode: ['safe', 'automatic', 'manual'].includes(data.mode ?? '') ? data.mode! : 'safe',
    escapeStyle: ['backslash', 'code', 'entity'].includes(data.escapeStyle ?? '') ? data.escapeStyle! : 'backslash',
    autoThreshold: number(data.autoThreshold, 0.98, 0.95, 1),
    ignoredTags: Array.isArray(data.ignoredTags) ? data.ignoredTags.filter((s): s is string => typeof s === 'string').map(s => s.toLowerCase()) : [],
    retentionDays: Math.round(number(data.retentionDays, 30, 1, 365)),
    retentionCount: Math.round(number(data.retentionCount, 100, 1, 1000)),
  };
}
