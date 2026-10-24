import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../.cache/browser/node_modules/playwright/index.mjs';

// Optional browser regression check, using the same tooling as capture-demo.mjs.
const origin = process.env.SIMULATION_ORIGIN ?? 'http://127.0.0.1:5173';
assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let token;
let missionId;
async function api(path, method, body) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert(response.ok, `${method} ${path}: ${response.status}`);
  return response.status === 204 ? null : (await response.json()).data;
}
try {
  await page.goto(origin);
  await page
    .getByLabel('Email', { exact: true })
    .fill(process.env.DEMO_RESEARCHER_EMAIL ?? 'researcher@aerqyn.local');
  await page
    .getByLabel('Password', { exact: true })
    .fill(process.env.DEMO_RESEARCHER_PASSWORD);
  const login = page.waitForResponse((response) =>
    response.url().endsWith('/auth/login'),
  );
  await page.getByRole('button', { name: /Enter laboratory/ }).click();
  token = (await (await login).json()).data.accessToken;
  const name = `Anomaly preview check ${Date.now()}`;
  const mission = await api('/missions', 'POST', {
    name,
    settings: { durationSeconds: 120, telemetryIntervalMs: 100 },
  });
  missionId = mission.id;
  await api(`/missions/${missionId}/start`, 'POST');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await page.getByText('1 connected viewer', { exact: true }).waitFor();
  await page.waitForFunction(() =>
    globalThis.document
      .querySelector('.coordinates')
      ?.textContent.includes('Latest sample'),
  );
  for (const type of ['GPS_JUMP', 'BATTERY_DROP', 'COMMUNICATION_LOSS']) {
    await page.getByLabel('Scenario').selectOption(type);
    await page.getByRole('button', { name: /Inject anomaly/ }).click();
    await page.waitForFunction((scenario) => {
      if (
        !globalThis.document
          .querySelector('.live-tag')
          ?.textContent.includes('ANOMALY PREVIEW')
      )
        return false;
      const card = globalThis.document.querySelector('.drone-card');
      if (scenario === 'GPS_JUMP')
        return (
          Number(card.querySelector('.coordinates span').textContent.slice(2)) >
          100
        );
      if (scenario === 'BATTERY_DROP')
        return (
          Number(
            card
              .querySelectorAll('.metrics strong')[1]
              .textContent.replace('%', '')
              .trim(),
          ) < 70
        );
      return (
        card.textContent.includes('disconnected') &&
        card.querySelector('.metrics strong').textContent.includes('0.0')
      );
    }, type);
    await page.waitForTimeout(1500);
    assert.match(
      await page.locator('.live-tag').textContent(),
      /ANOMALY PREVIEW/,
    );
    await mkdir('.cache/anomaly-verification', { recursive: true });
    await page.screenshot({
      path: `.cache/anomaly-verification/${type}.png`,
      fullPage: true,
    });
    await page.waitForFunction(
      () =>
        !globalThis.document
          .querySelector('.live-tag')
          ?.textContent.includes('ANOMALY PREVIEW'),
      undefined,
      { timeout: 12000 },
    );
    assert.match(
      await page.locator('.coordinates').first().textContent(),
      /Latest sample/,
    );
    const card = await page.locator('.drone-card').first().textContent();
    assert.match(card, /connected/);
    assert(!card.includes('disconnected'));
  }
  assert.equal(await page.locator('.timeline li').count(), 3);
  assert.deepEqual(errors, []);
  console.info(
    'Verified all three anomaly effects at 100ms telemetry, preview persistence, automatic return to live, and three alerts.',
  );
} finally {
  if (missionId && token) {
    try {
      await api(`/missions/${missionId}/stop`, 'POST');
      await api(`/missions/${missionId}`, 'DELETE');
    } finally {
      await browser.close();
    }
  } else await browser.close();
}
