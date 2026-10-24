import { z } from 'zod';
import {
  settingsSchema,
  telemetrySchema,
  type Telemetry,
} from '@aerqyn/simulation/contracts';
import { alertSchema, type Alert } from '@aerqyn/simulation/anomalies';

export const missionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  status: z.enum(['DRAFT', 'RUNNING', 'STOPPED', 'COMPLETED']),
  startedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  settings: settingsSchema,
});
export type Mission = z.infer<typeof missionSchema>;
export const sessionSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().positive(),
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    role: z.enum(['RESEARCHER', 'OBSERVER']),
  }),
});
export type Session = z.infer<typeof sessionSchema>;
export const replaySchema = z.object({
  runs: z.array(z.iso.datetime()),
  frames: z.array(telemetrySchema),
});
export { telemetrySchema, alertSchema };
export type { Telemetry, Alert };

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  token?: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 204) return schema.parse(undefined);
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = z
      .object({ error: z.object({ message: z.string() }) })
      .safeParse(payload);
    throw new HttpError(
      response.status,
      error.success ? error.data.error.message : 'Request failed',
    );
  }
  return z.object({ data: schema }).parse(payload).data;
}

// Keep live telemetry ordered; processed anomaly previews have a separate lifetime.
export function acceptFrame(
  previous: Telemetry | null,
  incoming: Telemetry,
): Telemetry {
  if (
    !previous ||
    incoming.startedAt > previous.startedAt ||
    (incoming.startedAt === previous.startedAt &&
      incoming.elapsedMs >= previous.elapsedMs)
  )
    return incoming;
  return previous;
}

export function visibleAnomalySample(
  sample: Telemetry | null,
  mission: Pick<Mission, 'id' | 'startedAt' | 'status'>,
  replayMode: boolean,
): Telemetry | null {
  return !replayMode &&
    mission.status === 'RUNNING' &&
    sample?.missionId === mission.id &&
    sample.startedAt === mission.startedAt
    ? sample
    : null;
}

export function mergeAlerts(previous: Alert[], incoming: Alert[]): Alert[] {
  return [
    ...new Map(
      [...previous, ...incoming].map((alert) => [alert.id, alert]),
    ).values(),
  ]
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    )
    .slice(0, 100);
}
