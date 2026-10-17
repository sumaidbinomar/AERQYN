import { z } from 'zod';
export const settingsSchema = z.strictObject({
  durationSeconds: z.number().int().min(10).max(3600).default(300),
  telemetryIntervalMs: z.number().int().min(100).max(5000).default(1000),
});
export const telemetrySchema = z.strictObject({
  missionId: z.uuid(),
  startedAt: z.iso.datetime(),
  timestamp: z.iso.datetime(),
  elapsedMs: z.number().nonnegative(),
  status: z.enum(['RUNNING', 'COMPLETED']),
  drones: z
    .array(
      z.strictObject({
        id: z.enum(['drone-1', 'drone-2', 'drone-3']),
        x: z.number().min(-1000).max(1000),
        y: z.number().min(-1000).max(1000),
        speed: z.number().nonnegative(),
        battery: z.number().min(0).max(100),
        connectionStatus: z.enum(['CONNECTED', 'DISCONNECTED']),
      }),
    )
    .length(3),
});
export type Telemetry = z.infer<typeof telemetrySchema>;
