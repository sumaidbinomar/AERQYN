import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { z } from 'zod';
import {
  acceptFrame,
  alertSchema,
  mergeAlerts,
  request,
  telemetrySchema,
  type Alert,
  type Telemetry,
} from './api';

export function useMissionStream(
  id: string,
  token: string,
  onUnauthorized: () => void,
  retry: number,
) {
  const [frame, setFrame] = useState<Telemetry | null>(null);
  const [anomalySample, setAnomalySample] = useState<Telemetry | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [viewers, setViewers] = useState(0);
  const [connection, setConnection] = useState('Connecting');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!anomalySample) return;
    const timer = setTimeout(() => setAnomalySample(null), 8000);
    return () => clearTimeout(timer);
  }, [anomalySample]);
  useEffect(() => {
    let active = true;
    const socket = io({ auth: { token }, reconnectionDelayMax: 5000 });
    const receive = (raw: unknown) => {
      const parsed = telemetrySchema.safeParse(raw);
      if (active && parsed.success && parsed.data.missionId === id)
        setFrame((old) => acceptFrame(old, parsed.data));
    };
    socket.on('connect', () => {
      setConnection('Joining');
      socket
        .timeout(8000)
        .emit(
          'mission:join',
          { missionId: id },
          (timeout: Error | null, raw: unknown) => {
            if (!active) return;
            const result = z
              .object({
                data: z.object({
                  missionId: z.uuid(),
                  telemetry: telemetrySchema.nullable(),
                }),
              })
              .safeParse(raw);
            if (timeout || !result.success) {
              setConnection('Subscription failed');
              setError('Unable to subscribe. Retry the connection.');
              return;
            }
            setConnection('Live');
            setError('');
            if (result.data.data.telemetry) receive(result.data.data.telemetry);
            void request(
              `/missions/${id}/alerts?limit=100`,
              z.array(alertSchema),
              token,
            )
              .then((items) => {
                if (active) setAlerts((old) => mergeAlerts(old, items));
              })
              .catch(() => {
                if (active)
                  setError('Alert history unavailable. Reconnect to retry.');
              });
          },
        );
    });
    socket.on('telemetry', receive);
    socket.on('anomaly:sample', (raw: unknown) => {
      const parsed = telemetrySchema.safeParse(raw);
      if (!active || !parsed.success || parsed.data.missionId !== id) return;
      setAnomalySample(parsed.data);
    });
    socket.on('alert', (raw: unknown) => {
      const parsed = alertSchema.safeParse(raw);
      if (active && parsed.success && parsed.data.missionId === id)
        setAlerts((old) => mergeAlerts(old, [parsed.data]));
    });
    socket.on('mission:viewers', (raw: unknown) => {
      const parsed = z
        .object({ missionId: z.uuid(), count: z.number().int().nonnegative() })
        .safeParse(raw);
      if (active && parsed.success && parsed.data.missionId === id)
        setViewers(parsed.data.count);
    });
    socket.on('disconnect', (reason) => {
      if (!active) return;
      setConnection('Disconnected');
      setViewers(0);
      if (reason === 'io server disconnect') onUnauthorized();
    });
    socket.on('connect_error', (failure: Error) => {
      if (!active) return;
      setConnection('Reconnecting');
      if (failure.message === 'UNAUTHORIZED') onUnauthorized();
    });
    return () => {
      active = false;
      socket.disconnect();
    };
  }, [id, token, onUnauthorized, retry]);
  return { frame, anomalySample, alerts, viewers, connection, error };
}
