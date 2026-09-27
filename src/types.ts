export type RiskLevel = 'safe' | 'ambiguous' | 'real-html' | 'ignored';
export type EscapeStyle = 'backslash' | 'code' | 'entity';
export interface Candidate {
  from: number;
  to: number;
  raw: string;
  tagName: string;
  language: 'html' | 'xml' | 'jsx' | 'generic' | 'unknown';
  contextBefore: string;
  contextAfter: string;
  risk: RiskLevel;
  confidence: number;
  reasons: string[];
}
export interface Edit { from: number; to: number; insert: string }
export interface Settings {
  mode: 'safe' | 'automatic' | 'manual';
  escapeStyle: EscapeStyle;
  autoThreshold: number;
  ignoredTags: string[];
  retentionDays: number;
  retentionCount: number;
}
