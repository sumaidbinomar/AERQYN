import { useEffect, useState } from 'react';

const initial = [
  {
    id: 'AX-01',
    name: 'KESTREL',
    x: 22,
    y: 34,
    speed: 12.4,
    battery: 87,
    color: '#62e6d3',
  },
  {
    id: 'AX-02',
    name: 'MERLIN',
    x: 63,
    y: 57,
    speed: 9.8,
    battery: 72,
    color: '#7aaeff',
  },
  {
    id: 'AX-03',
    name: 'OSPREY',
    x: 43,
    y: 76,
    speed: 14.1,
    battery: 91,
    color: '#f1b766',
  },
];

export default function Demo() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1800);
    return () => window.clearInterval(timer);
  }, []);
  const drones = initial.map((drone, index) => ({
    ...drone,
    x: 8 + ((drone.x + tick * (index + 2)) % 82),
    y: 12 + ((drone.y + tick * (index % 2 ? -1 : 1)) % 74),
    battery: Math.max(12, drone.battery - Math.floor(tick / 30)),
  }));
  return (
    <main className="demo-shell">
      <header className="demo-topbar">
        <div className="demo-brand">
          <b>⌁</b>
          <span>
            AERQYN<small>VIRTUAL FLIGHT LABORATORY</small>
          </span>
        </div>
        <div className="demo-live">
          <i /> SYNTHETIC ENVIRONMENT
        </div>
        <a href="https://github.com/" className="demo-github">
          Project on GitHub ↗
        </a>
      </header>
      <div className="demo-banner">
        <span>INTERACTIVE PREVIEW</span> Sample data only · No backend
        connection
      </div>
      <section className="demo-heading">
        <div>
          <p className="demo-eyebrow">MISSION / FIELD TEST 07</p>
          <h1>Northstar Survey</h1>
          <p>
            Coastal perimeter reconnaissance · Three virtual aircraft in shared
            airspace.
          </p>
        </div>
        <span className="demo-status">
          <i /> SIMULATED LIVE
        </span>
      </section>
      <section className="demo-layout">
        <div className="demo-main">
          <div className="demo-panel demo-field-panel">
            <div className="demo-panel-head">
              <div>
                <b>Airspace visualization</b>
                <small>LOCAL COORDINATE GRID · 2D</small>
              </div>
              <span>●&nbsp; 3 AIRCRAFT</span>
            </div>
            <div className="demo-field">
              <div className="demo-grid-label top">NORTH SECTOR / 04</div>
              <div className="demo-grid-label bottom">
                FLIGHT ZONE ALPHA · 2.4 KM²
              </div>
              <div className="demo-route route-one" />
              <div className="demo-route route-two" />
              {drones.map((drone) => (
                <div
                  className="demo-drone"
                  key={drone.id}
                  style={{
                    left: `${drone.x}%`,
                    top: `${drone.y}%`,
                    color: drone.color,
                  }}
                >
                  <span>⌁</span>
                  <b>{drone.id}</b>
                </div>
              ))}
            </div>
          </div>
          <div className="demo-drone-grid">
            {drones.map((drone) => (
              <article className="demo-panel demo-drone-card" key={drone.id}>
                <div className="demo-card-title">
                  <i style={{ background: drone.color }} />
                  <div>
                    <b>{drone.name}</b>
                    <small>{drone.id} · MULTIROTOR</small>
                  </div>
                  <span>CONNECTED</span>
                </div>
                <div className="demo-stats">
                  <div>
                    <small>GROUND SPEED</small>
                    <b>
                      {drone.speed} <em>m/s</em>
                    </b>
                  </div>
                  <div>
                    <small>BATTERY</small>
                    <b>
                      {drone.battery}
                      <em>%</em>
                    </b>
                  </div>
                  <div>
                    <small>POSITION</small>
                    <b>
                      {drone.x.toFixed(1)}° <em>/</em> {drone.y.toFixed(1)}°
                    </b>
                  </div>
                </div>
                <div className="demo-battery">
                  <i
                    style={{
                      width: `${drone.battery}%`,
                      background: drone.color,
                    }}
                  />
                </div>
              </article>
            ))}
          </div>
          <div className="demo-panel demo-chart">
            <div className="demo-panel-head">
              <div>
                <b>Telemetry history</b>
                <small>SIMULATED ALTITUDE · LAST 60 SECONDS</small>
              </div>
              <span>
                ALTITUDE&nbsp; <strong>120 m</strong>
              </span>
            </div>
            <div className="demo-chart-lines">
              <svg
                viewBox="0 0 900 120"
                preserveAspectRatio="none"
                aria-label="Illustrative sample telemetry chart"
              >
                <path
                  d="M0 80 C45 78 42 28 95 40 S155 96 205 70 S265 34 315 47 S370 100 425 65 S485 30 540 50 S600 88 650 58 S710 22 760 45 S820 90 900 30"
                  fill="none"
                  stroke="#62e6d3"
                  strokeWidth="2"
                />
                <path
                  d="M0 88 C55 100 75 52 130 62 S190 80 240 55 S300 85 355 73 S410 47 465 63 S530 94 580 72 S650 44 700 61 S770 83 820 52 S870 65 900 48"
                  fill="none"
                  stroke="#7aaeff"
                  strokeWidth="2"
                />
                <path
                  d="M0 60 C55 42 90 78 145 66 S200 30 255 50 S325 68 375 42 S450 76 505 54 S575 38 625 64 S700 90 755 60 S825 37 900 68"
                  fill="none"
                  stroke="#f1b766"
                  strokeWidth="2"
                />
              </svg>
            </div>
            <div className="demo-axis">
              <span>60s ago</span>
              <span>45s</span>
              <span>30s</span>
              <span>15s</span>
              <span>NOW</span>
            </div>
          </div>
        </div>
        <aside className="demo-side">
          <div className="demo-panel demo-ops">
            <div className="demo-panel-head">
              <div>
                <b>Mission overview</b>
                <small>RUN PARAMETERS</small>
              </div>
            </div>
            <div className="demo-overview">
              <span>MISSION STATUS</span>
              <b>
                <i /> In progress
              </b>
              <span>FLIGHT DURATION</span>
              <b>
                08:42 <small>/ 20:00</small>
              </b>
              <span>TELEMETRY RATE</span>
              <b>
                5 Hz <small>per aircraft</small>
              </b>
              <span>ACTIVE VIEWERS</span>
              <b>
                04 <small>observers</small>
              </b>
            </div>
            <button disabled>▶ &nbsp; Launch mission</button>
            <p>Controls are disabled in this sample preview.</p>
          </div>
          <div className="demo-panel demo-alerts">
            <div className="demo-panel-head">
              <div>
                <b>Security event feed</b>
                <small>SYNTHETIC DETECTION</small>
              </div>
              <span>02</span>
            </div>
            <article className="demo-alert amber">
              <i>!</i>
              <div>
                <b>GPS position jump</b>
                <p>AX-02 · Unusual displacement detected</p>
                <small>2 MIN AGO · HIGH</small>
              </div>
            </article>
            <article className="demo-alert red">
              <i>⌁</i>
              <div>
                <b>Signal degradation</b>
                <p>AX-03 · Packet loss above threshold</p>
                <small>5 MIN AGO · MEDIUM</small>
              </div>
            </article>
            <div className="demo-clear">
              ✓ &nbsp; All aircraft operating normally
            </div>
          </div>
          <div className="demo-panel demo-legend">
            <b>About this preview</b>
            <p>
              This dashboard uses generated sample telemetry to demonstrate
              AERQYN’s mission-control interface.
            </p>
            <a href="https://github.com/">Explore the source code ↗</a>
          </div>
        </aside>
      </section>
      <footer className="demo-footer">
        AERQYN <span>·</span> UAV DIGITAL TWIN &amp; CYBERSECURITY SIMULATION{' '}
        <span>·</span> NO PHYSICAL DRONES
      </footer>
    </main>
  );
}
