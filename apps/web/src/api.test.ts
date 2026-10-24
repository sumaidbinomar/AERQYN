import { describe, expect, it, vi, afterEach } from 'vitest';
import { simulate, settingsSchema } from '@aerqyn/simulation';
import {
  acceptFrame,
  mergeAlerts,
  request,
  HttpError,
  visibleAnomalySample,
  type Alert,
} from './api';
import { z } from 'zod';
const id = '00000000-0000-4000-8000-000000000001';
const start = new Date('2026-10-17T00:00:00Z');
const frame = (ms: number) =>
  simulate(id, start, settingsSchema.parse({}), new Date(+start + ms));
afterEach(() => vi.unstubAllGlobals());
describe('browser data boundaries', () => {
  it('shows delayed anomaly samples separately while keeping live telemetry ordered', () => {
    const latest = frame(5000);
    const sample = frame(1000);
    sample.drones[0]!.x += 100;
    const mission = {
      id,
      startedAt: start.toISOString(),
      status: 'RUNNING' as const,
    };
    expect(acceptFrame(latest, sample)).toBe(latest);
    expect(visibleAnomalySample(sample, mission, false)).toBe(sample);
    expect(visibleAnomalySample(null, mission, false)).toBeNull();
    expect(visibleAnomalySample(sample, mission, true)).toBeNull();
    expect(
      visibleAnomalySample(sample, { ...mission, status: 'STOPPED' }, false),
    ).toBeNull();
    expect(
      visibleAnomalySample(
        sample,
        { ...mission, startedAt: '2026-10-17T00:01:00.000Z' },
        false,
      ),
    ).toBeNull();
    expect(
      visibleAnomalySample(sample, { ...mission, id: 'other' }, false),
    ).toBeNull();
  });
  it('ignores late frames and old runs but accepts equal-time anomaly samples', () => {
    const latest = frame(2000);
    expect(acceptFrame(latest, frame(1000))).toBe(latest);
    const anomaly = frame(2000);
    anomaly.drones[0]!.x += 100;
    expect(acceptFrame(latest, anomaly)).toBe(anomaly);
    const next = { ...frame(0), startedAt: '2026-10-17T00:01:00.000Z' };
    expect(acceptFrame(latest, next)).toBe(next);
    expect(acceptFrame(next, latest)).toBe(next);
  });
  it('deduplicates reconnect alert history and bounds memory', () => {
    const alert: Alert = {
      id,
      missionId: id,
      startedAt: start.toISOString(),
      createdAt: start.toISOString(),
      droneId: 'drone-1',
      type: 'GPS_JUMP',
      message: 'Position jump',
    };
    expect(mergeAlerts([alert], [alert])).toEqual([alert]);
    expect(
      mergeAlerts(
        [],
        Array.from({ length: 110 }, (_, index) => ({
          ...alert,
          id: String(index),
        })),
      ),
    ).toHaveLength(100);
  });
  it('sends authenticated requests and rejects malformed successful responses', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { wrong: true } })),
      );
    vi.stubGlobal('fetch', fetcher);
    await expect(
      request('/missions', z.array(z.string()), 'token'),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/missions',
      expect.objectContaining({ headers: { Authorization: 'Bearer token' } }),
    );
  });
  it('preserves authorization failures for session handling', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Expired' } }), {
          status: 401,
        }),
      ),
    );
    await expect(request('/missions', z.unknown(), 'token')).rejects.toEqual(
      new HttpError(401, 'Expired'),
    );
  });
});
