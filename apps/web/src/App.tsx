import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { z } from 'zod';
import {
  HttpError,
  missionSchema,
  replaySchema,
  request,
  sessionSchema,
  type Mission,
  type Session,
  type Telemetry,
} from './api';
import { useMissionStream } from './useMissionStream';

const time = (value: string) => new Date(value).toLocaleTimeString();
const label = (value: string) => value.replaceAll('_', ' ').toLowerCase();

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">⌁</span>
      <div>
        AERQYN<small>VIRTUAL FLIGHT LABORATORY</small>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [notice, setNotice] = useState('');
  const logout = useCallback(() => {
    setSession(null);
    setNotice('Session ended. Sign in to continue.');
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(logout, session.expiresIn * 1000);
    return () => clearTimeout(timer);
  }, [session, logout]);
  return session ? (
    <Dashboard session={session} logout={logout} />
  ) : (
    <Login notice={notice} onLogin={setSession} />
  );
}

function Login({
  notice,
  onLogin,
}: {
  notice: string;
  onLogin: (session: Session) => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      onLogin(
        await request('/auth/login', sessionSchema, undefined, 'POST', {
          email: form.get('email'),
          password: form.get('password'),
        }),
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Login unavailable',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section className="login-story">
        <Brand />
        <div>
          <p className="eyebrow">SIMULATE / OBSERVE / UNDERSTAND</p>
          <h1>
            A clearer view.
            <br />
            <em>A safer sky.</em>
          </h1>
          <p className="intro">
            Explore a living digital twin. Follow every flight, introduce
            synthetic anomalies, and see the system respond.
          </p>
        </div>
        <div className="orbit" aria-hidden="true">
          <span>01</span>
          <span>02</span>
          <span>03</span>
        </div>
        <p className="footnote">
          LOCAL SIMULATION ENVIRONMENT · NO PHYSICAL DRONES
        </p>
      </section>
      <section className="login-panel">
        <p className="eyebrow">LABORATORY ACCESS</p>
        <h2>Welcome to mission control.</h2>
        <p className="muted">
          Sign in with your seeded Researcher or Observer account.
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              placeholder="researcher@aerqyn.local"
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          {(error || notice) && (
            <p role="alert" className="message">
              {error || notice}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? 'Authenticating...' : 'Enter laboratory →'}
          </button>
        </form>
        <div className="access-note">
          <b>Two perspectives. One airspace.</b>
          <p>
            Researchers manage missions and inject anomalies. Observers follow
            telemetry and review recorded flights.
          </p>
        </div>
      </section>
    </main>
  );
}

function Dashboard({
  session,
  logout,
}: {
  session: Session;
  logout: () => void;
}) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<Mission | 'new' | null>(null);
  const [offset, setOffset] = useState(0);
  const researcher = session.user.role === 'RESEARCHER';
  const report = useCallback(
    (failure: unknown) => {
      if (failure instanceof HttpError && failure.status === 401) logout();
      else
        setError(
          failure instanceof Error ? failure.message : 'Request unavailable',
        );
    },
    [logout],
  );
  const refresh = useCallback(async () => {
    try {
      const data = await request(
        `/missions?limit=20&offset=${offset}`,
        z.array(missionSchema),
        session.accessToken,
      );
      setMissions(data);
      setSelected((old) =>
        data.some((mission) => mission.id === old) ? old : (data[0]?.id ?? ''),
      );
      setError('');
    } catch (failure) {
      report(failure);
    } finally {
      setLoading(false);
    }
  }, [session.accessToken, report, offset]);
  useEffect(() => {
    // refresh updates state only after asynchronous HTTP completion.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  const mission = missions.find((entry) => entry.id === selected);
  return (
    <div className="app">
      <header className="topbar">
        <Brand />
        <span className="environment">
          <i /> SYNTHETIC ENVIRONMENT
        </span>
        <div className="account">
          <span>
            {session.user.email}
            <small>{label(session.user.role)}</small>
          </span>
          <button onClick={logout}>Sign out</button>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="section-heading">
            <p className="eyebrow">MISSION DIRECTORY</p>
            <span>{missions.length}</span>
          </div>
          {researcher && (
            <button className="new-mission" onClick={() => setEditor('new')}>
              + Create mission
            </button>
          )}
          {loading && <p className="muted">Loading missions...</p>}
          {!loading && !missions.length && (
            <p className="muted">
              No missions here yet.
              {researcher
                ? ' Create a mission to begin.'
                : ' A Researcher can create one.'}
            </p>
          )}
          <nav aria-label="Missions">
            {missions.map((item, index) => (
              <button
                key={item.id}
                className={`mission-item ${selected === item.id ? 'selected' : ''}`}
                onClick={() => setSelected(item.id)}
              >
                <span className="mission-number">
                  {String(offset + index + 1).padStart(2, '0')}
                </span>
                <span>
                  <b>{item.name}</b>
                  <small>
                    <i
                      className={
                        item.status === 'RUNNING' ? 'dot active' : 'dot'
                      }
                    />
                    {label(item.status)}
                  </small>
                </span>
                <span>›</span>
              </button>
            ))}
          </nav>
          <div className="pagination">
            <button
              disabled={offset === 0}
              onClick={() => setOffset((value) => value - 20)}
            >
              ← Previous
            </button>
            <button
              disabled={missions.length < 20}
              onClick={() => setOffset((value) => value + 20)}
            >
              Next →
            </button>
          </div>
          <div className="sidebar-bottom">
            <span className="eyebrow">YOUR ACCESS</span>
            <h3>{researcher ? 'Researcher' : 'Observer'}</h3>
            <p>
              {researcher
                ? 'Design flights. Test resilience.'
                : 'Follow flights. Explore results.'}
            </p>
            <p className="footnote">All activity is local and synthetic.</p>
          </div>
        </aside>
        <main className="main-content">
          {error && (
            <div className="message" role="alert">
              {error} <button onClick={() => void refresh()}>Retry</button>
            </div>
          )}
          {mission ? (
            <MissionView
              key={mission.id}
              mission={mission}
              session={session}
              logout={logout}
              refresh={refresh}
              report={report}
              edit={() => setEditor(mission)}
            />
          ) : (
            <div className="empty">
              <p className="eyebrow">READY WHEN YOU ARE</p>
              <h1>Your next flight starts here.</h1>
              <p>Select a mission or create a new simulation.</p>
            </div>
          )}
        </main>
      </div>
      {editor && (
        <MissionEditor
          mission={editor}
          token={session.accessToken}
          close={() => setEditor(null)}
          saved={() => {
            setEditor(null);
            void refresh();
          }}
          unauthorized={logout}
        />
      )}
    </div>
  );
}

function MissionEditor({
  mission,
  token,
  close,
  saved,
  unauthorized,
}: {
  mission: Mission | 'new';
  token: string;
  close: () => void;
  saved: () => void;
  unauthorized: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const existing = mission === 'new' ? null : mission;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await request(
        existing ? `/missions/${existing.id}` : '/missions',
        missionSchema,
        token,
        existing ? 'PATCH' : 'POST',
        {
          name: values.get('name'),
          description: values.get('description'),
          settings: {
            durationSeconds: Number(values.get('duration')),
            telemetryIntervalMs: Number(values.get('interval')),
          },
        },
      );
      saved();
    } catch (failure) {
      if (failure instanceof HttpError && failure.status === 401)
        unauthorized();
      else setError(failure instanceof Error ? failure.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
      className="modal"
      aria-labelledby="editor-title"
    >
      <form onSubmit={(event) => void submit(event)}>
        <p className="eyebrow">FLIGHT CONFIGURATION</p>
        <h2 id="editor-title">
          {existing ? 'Edit mission' : 'Create a mission'}
        </h2>
        <label>
          Name
          <input
            autoFocus
            name="name"
            required
            maxLength={100}
            defaultValue={existing?.name}
          />
        </label>
        <label>
          Description
          <textarea
            name="description"
            maxLength={2000}
            defaultValue={existing?.description}
          />
        </label>
        <div className="form-row">
          <label>
            Duration (seconds)
            <input
              name="duration"
              type="number"
              required
              min={10}
              max={3600}
              step={1}
              defaultValue={existing?.settings.durationSeconds ?? 300}
            />
          </label>
          <label>
            Telemetry interval (ms)
            <input
              name="interval"
              type="number"
              required
              min={100}
              max={5000}
              step={1}
              defaultValue={existing?.settings.telemetryIntervalMs ?? 1000}
            />
          </label>
        </div>
        <p className="muted">
          Three virtual drones follow predefined 2D routes.
        </p>
        {error && (
          <p role="alert" className="message">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? 'Saving...' : 'Save mission'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function MissionView({
  mission,
  session,
  logout,
  refresh,
  report,
  edit,
}: {
  mission: Mission;
  session: Session;
  logout: () => void;
  refresh: () => Promise<void>;
  report: (failure: unknown) => void;
  edit: () => void;
}) {
  const [retry, setRetry] = useState(0);
  const { frame, alerts, viewers, connection, error } = useMissionStream(
    mission.id,
    session.accessToken,
    logout,
    retry,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [replay, setReplay] = useState<z.infer<typeof replaySchema> | null>(
    null,
  );
  const [replayMode, setReplayMode] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const researcher = session.user.role === 'RESEARCHER';
  const currentFrame = frame?.startedAt === mission.startedAt ? frame : null;
  const shown = replayMode ? (replay?.frames[cursor] ?? null) : currentFrame;
  useEffect(() => {
    if (!playing || !replay) return;
    const current = replay.frames[cursor];
    const next = replay.frames[cursor + 1];
    const timer = setTimeout(
      () => {
        if (next) setCursor((value) => value + 1);
        else setPlaying(false);
      },
      current && next ? Math.max(100, next.elapsedMs - current.elapsedMs) : 100,
    );
    return () => clearTimeout(timer);
  }, [playing, cursor, replay]);
  async function action(path: string, body: unknown = {}, method = 'POST') {
    setBusy(true);
    setNotice('');
    try {
      await request(
        `/missions/${mission.id}${path}`,
        z.unknown(),
        session.accessToken,
        method,
        method === 'DELETE' ? undefined : body,
      );
      setNotice(
        path === '/anomalies'
          ? 'Anomaly queued. Awaiting worker analysis.'
          : 'Mission updated.',
      );
      await refresh();
    } catch (failure) {
      report(failure);
    } finally {
      setBusy(false);
    }
  }
  async function loadReplay(startedAt?: string) {
    setBusy(true);
    setPlaying(false);
    try {
      const result = await request(
        `/missions/${mission.id}/replay${startedAt ? `?startedAt=${encodeURIComponent(startedAt)}` : ''}`,
        replaySchema,
        session.accessToken,
      );
      setReplay(result);
      setCursor(0);
      setReplayMode(true);
    } catch (failure) {
      report(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="mission-heading">
        <div>
          <p className="eyebrow">FLIGHT OPERATIONS / MISSION OVERVIEW</p>
          <h1>{mission.name}</h1>
          <p className="muted">
            {mission.description || 'Three drones. One shared airspace.'}
          </p>
        </div>
        <span
          className={`status ${mission.status === 'RUNNING' ? 'running' : ''}`}
        >
          {label(mission.status)}
        </span>
      </div>
      <div className="mission-toolbar">
        <div className="actions">
          {researcher ? (
            <>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void action(mission.status === 'RUNNING' ? '/stop' : '/start')
                }
              >
                {mission.status === 'RUNNING'
                  ? '■ Stop mission'
                  : '▶ Launch mission'}
              </button>
              <button
                disabled={busy || mission.status === 'RUNNING'}
                onClick={edit}
              >
                Edit
              </button>
              <button
                disabled={busy || mission.status === 'RUNNING'}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </button>
            </>
          ) : (
            <span className="muted">Observer access · view only</span>
          )}
        </div>
        <span className="muted">
          {mission.settings.durationSeconds}s duration /{' '}
          {mission.settings.telemetryIntervalMs}ms interval
        </span>
      </div>
      {confirmDelete && (
        <div className="message" role="alert">
          Delete this mission and all its alerts and recordings?{' '}
          <button
            disabled={busy}
            onClick={() => {
              setConfirmDelete(false);
              void action('', undefined, 'DELETE');
            }}
          >
            Confirm deletion
          </button>{' '}
          <button onClick={() => setConfirmDelete(false)}>Cancel</button>
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="message">
          {error}
        </p>
      )}
      <div className="operations-grid">
        <section className="field-panel panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">AIRSPACE</span>
              <h2>Digital twin</h2>
            </div>
            <span className={`live-tag ${replayMode ? 'replay-tag' : ''}`}>
              {replayMode ? '◷ RECORDED' : `● ${connection.toUpperCase()}`}
            </span>
          </div>
          <Field
            frame={shown}
            replay={replayMode}
            interval={mission.settings.telemetryIntervalMs}
          />
          <div className="field-footer">
            <span>2D CARTESIAN FIELD · SYNTHETIC UNITS</span>
            <span>
              {shown
                ? `${(shown.elapsedMs / 1000).toFixed(1)}s elapsed · ${time(shown.timestamp)}`
                : 'Awaiting telemetry'}
            </span>
          </div>
          <div className="replay-controls">
            <div className="actions">
              <button
                className={!replayMode ? 'chosen' : ''}
                onClick={() => {
                  setReplayMode(false);
                  setPlaying(false);
                }}
              >
                Live
              </button>
              <button
                disabled={busy}
                className={replayMode ? 'chosen' : ''}
                onClick={() => void loadReplay()}
              >
                Recorded runs
              </button>
            </div>
            {replayMode ? (
              <>
                <select
                  aria-label="Recorded run"
                  disabled={busy}
                  value={replay?.frames[0]?.startedAt ?? replay?.runs[0] ?? ''}
                  onChange={(event) => void loadReplay(event.target.value)}
                >
                  {replay?.runs.map((run) => (
                    <option key={run} value={run}>
                      {new Date(run).toLocaleString()}
                    </option>
                  ))}
                </select>
                {replay?.frames.length ? (
                  <>
                    <button
                      aria-label={playing ? 'Pause replay' : 'Play replay'}
                      onClick={() => {
                        if (cursor === replay.frames.length - 1) setCursor(0);
                        setPlaying(!playing);
                      }}
                    >
                      {playing ? 'Pause' : 'Play'}
                    </button>
                    <input
                      aria-label="Replay position"
                      type="range"
                      min={0}
                      max={replay.frames.length - 1}
                      value={cursor}
                      onChange={(event) => {
                        setPlaying(false);
                        setCursor(Number(event.target.value));
                      }}
                    />
                    <span>
                      {cursor + 1}/{replay.frames.length}
                    </span>
                  </>
                ) : (
                  <p className="muted">No recorded frames yet.</p>
                )}
              </>
            ) : (
              <span className="muted">
                {viewers} connected {viewers === 1 ? 'viewer' : 'viewers'}
              </span>
            )}
          </div>
        </section>
        <aside className="panel anomaly-panel">
          <p className="eyebrow">RESILIENCE TESTING</p>
          <h2>Introduce an anomaly</h2>
          <p className="muted">
            A single synthetic sample. Watch the analysis arrive in the
            timeline.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void action('/anomalies', {
                droneId: form.get('drone'),
                type: form.get('type'),
              });
            }}
          >
            <fieldset
              disabled={
                !researcher ||
                busy ||
                mission.status !== 'RUNNING' ||
                replayMode
              }
            >
              <label>
                Target drone
                <select name="drone">
                  <option value="drone-1">Drone 01</option>
                  <option value="drone-2">Drone 02</option>
                  <option value="drone-3">Drone 03</option>
                </select>
              </label>
              <label>
                Scenario
                <select name="type">
                  <option value="GPS_JUMP">GPS position jump</option>
                  <option value="BATTERY_DROP">Sudden battery drop</option>
                  <option value="COMMUNICATION_LOSS">Communication loss</option>
                </select>
              </label>
              <button className="warning">ϟ Inject anomaly</button>
            </fieldset>
          </form>
          <p className="footnote">
            {!researcher
              ? 'RESEARCHER ACCESS REQUIRED'
              : replayMode
                ? 'RETURN TO LIVE TO INJECT'
                : mission.status !== 'RUNNING'
                  ? 'LAUNCH A MISSION TO ENABLE'
                  : 'SYNTHETIC DATA ONLY'}
          </p>
          <div className="connection-note">
            Stream: {connection}
            <br />
            <small>
              Last sample: {currentFrame ? time(currentFrame.timestamp) : '—'}
            </small>
            {(connection !== 'Live' || error) && (
              <button onClick={() => setRetry((value) => value + 1)}>
                Retry stream
              </button>
            )}
          </div>
        </aside>
        <section className="telemetry-grid" aria-label="Drone telemetry">
          {['drone-1', 'drone-2', 'drone-3'].map((id, index) => {
            const drone = shown?.drones.find((item) => item.id === id);
            return (
              <article
                className={`panel drone-card drone-color-${index}`}
                key={id}
              >
                <div className="section-heading">
                  <h3>
                    <span>✣</span> Drone 0{index + 1}
                  </h3>
                  <span className="footnote">
                    {drone ? label(drone.connectionStatus) : 'NO DATA'}
                  </span>
                </div>
                <div className="metrics">
                  <div>
                    <small>SPEED</small>
                    <strong>
                      {drone?.speed.toFixed(1) ?? '—'} <em>u/s</em>
                    </strong>
                  </div>
                  <div>
                    <small>BATTERY</small>
                    <strong>
                      {drone?.battery.toFixed(1) ?? '—'} <em>%</em>
                    </strong>
                  </div>
                </div>
                <div className="battery">
                  <span style={{ width: `${drone?.battery ?? 0}%` }} />
                </div>
                <div className="coordinates">
                  <span>X {drone?.x.toFixed(1) ?? '—'}</span>
                  <span>Y {drone?.y.toFixed(1) ?? '—'}</span>
                  <span>
                    {replayMode ? 'Recorded sample' : 'Latest sample'}
                  </span>
                </div>
              </article>
            );
          })}
        </section>
        <section className="panel timeline">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">SECURITY OBSERVATIONS</span>
              <h2>Alert timeline</h2>
            </div>
            <span className="count">{alerts.length}</span>
          </div>
          <p className="muted timeline-caption">
            Latest 100 alerts across all runs ·{' '}
            {replayMode ? 'history remains live during replay' : 'updates live'}
          </p>
          {alerts.length ? (
            <ol>
              {alerts.map((alert) => (
                <li key={alert.id}>
                  <span className="alert-symbol">!</span>
                  <div>
                    <h3>
                      {label(alert.type)} <small>{alert.droneId}</small>
                    </h3>
                    <p>{alert.message}</p>
                    <small>
                      Run {new Date(alert.startedAt).toLocaleString()}
                    </small>
                  </div>
                  <time dateTime={alert.createdAt}>
                    {time(alert.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <div className="timeline-empty">
              <span>◎</span>
              <p>
                No alerts received.
                <br />
                <small>Detected anomalies will appear here.</small>
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Field({
  frame,
  replay,
  interval,
}: {
  frame: Telemetry | null;
  replay: boolean;
  interval: number;
}) {
  return (
    <div className="field">
      <svg
        viewBox="-10 -10 220 120"
        role="img"
        aria-label="Animated synthetic drone field"
      >
        <defs>
          <pattern
            id="grid"
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 10 0 L 0 0 0 10"
              fill="none"
              stroke="currentColor"
              strokeWidth=".15"
            />
          </pattern>
        </defs>
        <rect x="-10" y="-10" width="220" height="120" fill="url(#grid)" />
        <rect x="0" y="0" width="100" height="100" className="field-boundary" />
        <path d="M20 20 H80 V80 H20 Z" className="route" />
        <text x="2" y="-3" className="field-text">
          NORMAL FLIGHT BOUNDARY
        </text>
        <text x="117" y="98" className="field-text">
          ANOMALY OBSERVATION AREA
        </text>
        {frame?.drones.map((drone, index) => (
          <g
            key={drone.id}
            className={`drone-marker drone-color-${index}`}
            style={{
              transform: `translate(${drone.x}px, ${drone.y}px)`,
              transitionDuration: replay ? '0ms' : `${interval}ms`,
            }}
          >
            <circle r="5" className="drone-halo" />
            <path d="M-3 -3 L3 3 M-3 3 L3 -3" />
            <circle r="1.5" />
            <text x="6" y="-4">
              0{index + 1}
            </text>
          </g>
        ))}
      </svg>
      {!frame && (
        <div className="field-empty">
          <span>◎</span>
          <p>
            {replay ? 'No recording available' : 'Waiting for a flight signal'}
          </p>
          <small>
            {replay
              ? 'Launch a mission to record telemetry.'
              : 'Launch a mission to bring the airspace to life.'}
          </small>
        </div>
      )}
      <span className="axis-label">Y ↑ / X →</span>
    </div>
  );
}
