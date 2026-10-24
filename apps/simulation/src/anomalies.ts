import { z } from 'zod';
import { telemetrySchema, type Telemetry } from './contracts.js';

export const injectionSchema = z.strictObject({
  droneId: z.enum(['drone-1', 'drone-2', 'drone-3']),
  type: z.enum(['GPS_JUMP', 'BATTERY_DROP', 'COMMUNICATION_LOSS']),
});
export const analysisSchema = z.strictObject({
  baseline: telemetrySchema,
  observed: telemetrySchema,
});
export const alertSchema = z.strictObject({
  id: z.uuid(),
  missionId: z.uuid(),
  startedAt: z.iso.datetime(),
  droneId: injectionSchema.shape.droneId,
  type: injectionSchema.shape.type,
  message: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
});
export type Alert = z.infer<typeof alertSchema>;
export const alertChannel = 'aerqyn:alerts';
export const anomalySampleChannel = 'aerqyn:anomaly-samples';

// Each command affects one synthetic sample. The next normal tick restores the route.
export function injectAnomaly(
  baseline: Telemetry,
  command: z.infer<typeof injectionSchema>,
): Telemetry {
  const observed = structuredClone(baseline);
  const drone = observed.drones.find((entry) => entry.id === command.droneId)!;
  if (command.type === 'GPS_JUMP') drone.x += 100;
  if (command.type === 'BATTERY_DROP')
    drone.battery = Math.max(0, drone.battery - 40);
  if (command.type === 'COMMUNICATION_LOSS') {
    drone.connectionStatus = 'DISCONNECTED';
    drone.speed = 0;
  }
  return telemetrySchema.parse(observed);
}

// Detection compares measurements; it does not trust the requested anomaly label.
export function detectAnomalies(baseline: Telemetry, observed: Telemetry) {
  if (
    baseline.missionId !== observed.missionId ||
    baseline.startedAt !== observed.startedAt
  )
    throw new Error('Cannot compare different mission runs');
  const seconds = Math.max(
    0,
    (Date.parse(observed.timestamp) - Date.parse(baseline.timestamp)) / 1000,
  );
  const findings: Pick<Alert, 'droneId' | 'type' | 'message'>[] = [];
  for (const drone of observed.drones) {
    const previous = baseline.drones.find((entry) => entry.id === drone.id);
    if (!previous) throw new Error('Missing baseline drone');
    if (
      Math.hypot(drone.x - previous.x, drone.y - previous.y) >
      20 + previous.speed * seconds
    )
      findings.push({
        droneId: drone.id,
        type: 'GPS_JUMP',
        message:
          'Position displacement exceeds expected movement plus 20 field units',
      });
    if (previous.battery - drone.battery > 20)
      findings.push({
        droneId: drone.id,
        type: 'BATTERY_DROP',
        message: 'Battery fell by more than 20 percentage points',
      });
    if (
      previous.connectionStatus === 'CONNECTED' &&
      drone.connectionStatus === 'DISCONNECTED'
    )
      findings.push({
        droneId: drone.id,
        type: 'COMMUNICATION_LOSS',
        message: 'Synthetic connection changed to disconnected',
      });
  }
  return findings;
}
