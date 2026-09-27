import { StateEffect, StateField } from '@codemirror/state';
export const ignoreInstance = StateEffect.define<{ from: number; to: number }>();
export const ignoredInstances = StateField.define<{ from: number; to: number }[]>({
  create: () => [],
  update(value, tr) {
    const mapped = value.filter(r => !tr.changes.touchesRange(r.from, r.to))
      .map(r => ({ from: tr.changes.mapPos(r.from, 1), to: tr.changes.mapPos(r.to, -1) }));
    for (const effect of tr.effects) if (effect.is(ignoreInstance)) mapped.push(effect.value);
    return mapped;
  },
});
