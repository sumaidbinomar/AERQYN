import { expect, it } from 'vitest';
import { simulate, settingsSchema } from './index.js';
import {
  detectAnomalies,
  injectAnomaly,
  injectionSchema,
} from './anomalies.js';

const start = new Date('2026-10-17T00:00:00Z');
const baseline = simulate(
  '00000000-0000-4000-8000-000000000001',
  start,
  settingsSchema.parse({}),
  start,
);
it.each(injectionSchema.shape.type.options)(
  'detects %s from changed measurements',
  (type) => {
    const observed = injectAnomaly(baseline, { type, droneId: 'drone-2' });
    expect(detectAnomalies(baseline, observed)).toEqual([
      { droneId: 'drone-2', type, message: expect.any(String) },
    ]);
    expect(observed.drones[0]).toEqual(baseline.drones[0]);
    expect(baseline.drones[1]!.connectionStatus).toBe('CONNECTED');
  },
);
it('does not flag normal movement or threshold boundaries', () => {
  const normal = simulate(
    baseline.missionId,
    start,
    settingsSchema.parse({}),
    new Date(start.getTime() + 5000),
  );
  expect(detectAnomalies(baseline, normal)).toEqual([]);
  const boundary = structuredClone(baseline);
  boundary.drones[0]!.x += 20;
  boundary.drones[0]!.battery -= 20;
  expect(detectAnomalies(baseline, boundary)).toEqual([]);
});
it('rejects comparisons across mission runs', () => {
  expect(() =>
    detectAnomalies(baseline, {
      ...baseline,
      startedAt: new Date().toISOString(),
    }),
  ).toThrow();
});
