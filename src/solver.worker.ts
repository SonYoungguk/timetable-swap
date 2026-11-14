import { solve } from '../shared/solver.ts';
import type { SolveOptions } from '../shared/solver.ts';
import type { Db } from '../shared/types.ts';

self.onmessage = (e: MessageEvent<{ db: Db; mode: SolveOptions['mode']; timeMs: number }>) => {
  const { db, mode, timeMs } = e.data;
  const result = solve(db, {
    mode,
    timeMs,
    seed: Date.now() % 100000,
    onProgress: (progress) => self.postMessage({ type: 'progress', progress }),
  });
  self.postMessage({ type: 'done', result });
};
