import { describe, expect, it } from 'vitest';
import { settingsSchema, simulate, telemetrySchema } from './index.js';

const id = '00000000-0000-4000-8000-000000000001';
const start = new Date('2026-10-17T00:00:00.000Z');
const settings = settingsSchema.parse({ durationSeconds: 60 });
describe('Deterministic three-drone simulation', () => {
  it('produces three distinct drones and repeats a square route every 48 seconds', () => {
    const first = simulate(id, start, settings, start);
    expect(first.drones).toHaveLength(3);
    expect(
      new Set(first.drones.map((drone) => `${drone.x},${drone.y}`)).size,
    ).toBe(3);
    const later = simulate(id, start, settings, new Date(+start + 48000));
    expect(later.drones.map(({ x, y }) => [x, y])).toEqual(
      first.drones.map(({ x, y }) => [x, y]),
    );
    expect(later.drones[0]!.battery).toBeLessThan(100);
  });
  it('moves at the configured speed and is independent of process memory', () => {
    const sample = simulate(id, start, settings, new Date(+start + 2000));
    expect(sample.drones[0]).toMatchObject({ x: 30, y: 20, speed: 5 });
    expect(sample).toEqual(
      simulate(id, new Date(start), settings, new Date(+start + 2000)),
    );
  });
  it('clamps time, stops at duration, and stays inside the field', () => {
    expect(simulate(id, start, settings, new Date(+start - 1)).elapsedMs).toBe(
      0,
    );
    const end = simulate(id, start, settings, new Date(+start + 100000));
    expect(end.status).toBe('COMPLETED');
    expect(end.elapsedMs).toBe(60000);
    expect(end.drones.every((drone) => drone.speed === 0)).toBe(true);
    for (let second = 0; second <= 60; second++)
      expect(
        telemetrySchema.safeParse(
          simulate(id, start, settings, new Date(+start + second * 1000)),
        ).success,
      ).toBe(true);
  });
});
