import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '../.cache/browser/node_modules/playwright/index.mjs';

// Optional documentation tool; install Playwright under .cache/browser, not the app.
// Uses only the local synthetic stack and never prints passwords or tokens.
const origin =
  process.env.SIMULATION_ORIGIN ??
  `http://127.0.0.1:${process.env.WEB_PORT ?? 5173}`;
assert(
  ['127.0.0.1', 'localhost'].includes(new URL(origin).hostname),
  'Demo capture requires localhost',
);
const media = fileURLToPath(new URL('../docs/media/', import.meta.url));
await mkdir(media, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: {
    dir: '.cache/demo-video',
    size: { width: 1440, height: 1000 },
  },
  timezoneId: 'Asia/Kolkata',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let token;
let missionId;
async function login(role) {
  await page
    .getByLabel('Email', { exact: true })
    .fill(
      process.env[`DEMO_${role}_EMAIL`] ?? `${role.toLowerCase()}@aerqyn.local`,
    );
  await page
    .getByLabel('Password', { exact: true })
    .fill(process.env[`DEMO_${role}_PASSWORD`]);
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith('/auth/login') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /Enter laboratory/ }).click();
  const result = await response;
  assert.equal(result.status(), 200);
  await page.getByRole('button', { name: 'Sign out' }).waitFor();
  return (await result.json()).data.accessToken;
}
async function screenshot(name) {
  await page.screenshot({ path: `${media}${name}.png`, fullPage: true });
}
try {
  await page.goto(origin);
  await screenshot('login');
  token = await login('RESEARCHER');
  await page
    .getByRole('button', { name: '+ Create mission', exact: true })
    .click();
  await page
    .getByLabel('Name', { exact: true })
    .fill('AERQYN verification flight');
  await page
    .getByLabel('Description', { exact: true })
    .fill(
      'Three synthetic drones. Live telemetry, asynchronous anomaly detection and recorded replay.',
    );
  await page.getByLabel('Duration (seconds)', { exact: true }).fill('120');
  await page.getByLabel('Telemetry interval (ms)', { exact: true }).fill('500');
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/missions') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save mission', exact: true }).click();
  const created = await saved;
  assert.equal(created.status(), 201);
  missionId = (await created.json()).data.id;
  await page
    .getByRole('button', { name: /AERQYN verification flight/ })
    .click();
  await page.getByRole('button', { name: /Launch mission/ }).click();
  await page.getByText('1 connected viewer', { exact: true }).waitFor();
  await page.waitForFunction(() =>
    globalThis.document
      .querySelector('.field-footer')
      ?.textContent.includes('elapsed'),
  );
  // A short presentation pause also demonstrates deterministic movement in the video.
  await page.waitForTimeout(2500);
  const before = await page.locator('.coordinates').first().textContent();
  await page.waitForTimeout(1500);
  assert.notEqual(
    await page.locator('.coordinates').first().textContent(),
    before,
  );
  await screenshot('dashboard');
  for (const [type, heading] of [
    ['GPS_JUMP', 'gps jump'],
    ['BATTERY_DROP', 'battery drop'],
    ['COMMUNICATION_LOSS', 'communication loss'],
  ]) {
    await page.getByLabel('Scenario').selectOption(type);
    await page.getByRole('button', { name: /Inject anomaly/ }).click();
    await page.locator('.timeline h3').filter({ hasText: heading }).waitFor();
    await page.waitForTimeout(800);
  }
  assert.equal(await page.locator('.timeline li').count(), 3);
  await screenshot('alerts');
  await page.getByRole('button', { name: /Stop mission/ }).click();
  await page.getByRole('button', { name: /Launch mission/ }).waitFor();
  await page
    .getByRole('button', { name: 'Recorded runs', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Play replay', exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Play replay', exact: true }).click();
  await page.waitForFunction(
    () =>
      Number(
        globalThis.document.querySelector('[aria-label="Replay position"]')
          ?.value,
      ) > 0,
  );
  await page.getByRole('button', { name: 'Pause replay', exact: true }).click();
  await page
    .getByRole('slider', { name: 'Replay position', exact: true })
    .focus();
  await page
    .getByRole('slider', { name: 'Replay position', exact: true })
    .press('End');
  await screenshot('replay');
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await login('OBSERVER');
  await page
    .getByRole('button', { name: /AERQYN verification flight/ })
    .click();
  assert.equal(
    await page.getByRole('button', { name: /Launch mission/ }).count(),
    0,
  );
  assert.equal(
    await page.getByRole('button', { name: /Inject anomaly/ }).isDisabled(),
    true,
  );
  await screenshot('observer');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
    true,
    'Mobile layout must not overflow horizontally',
  );
  await screenshot('mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(1500);
  assert.deepEqual(errors, []);
  console.info(
    'Browser demo verified: login, mission creation, movement, three live alerts, stop, replay, Observer controls and mobile layout.',
  );
} finally {
  // Remove only the mission this capture created; retain journal evidence on its volume.
  if (missionId && token) {
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    await fetch(`${origin}/api/missions/${missionId}/stop`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    const response = await fetch(`${origin}/api/missions/${missionId}`, {
      method: 'DELETE',
      headers,
    });
    assert.equal(response.status, 204, 'Clean up demo mission');
  }
  await context.close();
  await page.video().saveAs(`${media}demo.webm`);
  await browser.close();
}
