import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { startHarness, actors, addRound, finishTask } from './harness.mjs';

test('React: repositories, completion, reopening and another planning round on desktop/mobile', { timeout: 120000 }, async (t) => {
  const h = await startHarness();
  t.after(() => h.close());
  const mission = await h.clients.owner.createMission({ title: 'E2E evolving product', description: 'Coordinate agents across many years of small verified improvements.' });
  const round = await addRound(h, mission.id, 1);
  await finishTask(h, round.task);
  h.proofs.set('example/core', { id: 101, proof: { missionId: mission.id, registeredBy: actors.owner.id } });
  h.proofs.set('example/docs', { id: 102, proof: { missionId: mission.id, registeredBy: actors.owner.id } });
  const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  // Only external providers are stubbed. Every Spark request reaches the real backend/database.
  await context.route('https://**/*', (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: '' }));
  await context.addInitScript(() => {
    window.Clerk = { loaded: true, user: { id: 'test-owner', username: 'MossPanda', unsafeMetadata: {} }, session: { getToken: async () => 'owner' }, addListener() {}, handleRedirectCallback: async () => {} };
    localStorage.setItem('spark-theme', 'light');
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${h.url}/#mission/${mission.id}`);
  await expect(page.getByText('Ongoing mission', { exact: true })).toBeVisible();
  await expect(page.getByText('This round is clear.', { exact: true })).toBeVisible();
  await expect(page.locator('.mission-progress-panel')).toHaveCSS('animation-name', 'none');

  for (const name of ['core', 'docs']) {
    await page.getByRole('button', { name: '+ Link GitHub', exact: true }).click();
    await page.getByLabel('GitHub repository', { exact: true }).fill(`example/${name}`);
    await page.getByRole('button', { name: 'Verify & link', exact: true }).click();
    await expect(page.locator('.mission-repo').getByRole('link', { name: `example/${name} ↗`, exact: true })).toBeVisible();
  }
  await expect(page.locator('.mission-repo')).toHaveCount(2);
  await page.getByRole('button', { name: '+ Link GitHub', exact: true }).click();
  await page.getByLabel('GitHub repository', { exact: true }).fill('example/core');
  await page.getByRole('button', { name: 'Verify & link', exact: true }).click();
  await expect(page.getByText('This repository is already linked to the mission', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify & link', exact: true })).toBeEnabled();
  await page.locator('.mission-codebase-heading').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.mission-code-evidence summary').click();
  await expect(page.locator('.mission-code-evidence').getByText('Builder · accepted', { exact: true })).toBeVisible();
  await page.locator('.mission-goal-control summary').click();
  await page.getByLabel('Explain how the mission goal was reached').fill('All current goals have been independently verified.');
  await page.getByRole('button', { name: 'Mark goal complete', exact: true }).click();
  await expect(page.getByText('Goal reached', { exact: true })).toBeVisible();
  await expect(page.getByText('+ Start a planning thread', { exact: true })).toHaveCount(0);
  await page.getByLabel('What comes next?', { exact: true }).fill('Continue into the next year with more product improvements.');
  await page.getByRole('button', { name: 'Reopen for more work', exact: true }).click();
  await expect(page.getByText('Ongoing mission', { exact: true })).toBeVisible();
  await page.getByText('+ Start a planning thread', { exact: true }).click();
  await page.getByRole('combobox', { name: /Continue from/ }).selectOption(round.gate.id);
  await page.getByLabel('Thread title', { exact: true }).fill('Next year of improvements');
  await page.getByLabel('Question for contributors', { exact: true }).fill('Which improvement should agents work on next year?');
  await page.getByRole('button', { name: 'Start thread ↗', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Next year of improvements', exact: true })).toBeVisible();
  const [newGate] = (await h.clients.owner.listDecisionGates(mission.id)).filter(({ gate }) => gate.title === 'Next year of improvements');
  assert.equal(newGate.gate.parentGateId, round.gate.id);
  assert.equal(newGate.gate.level, 'MILESTONE');

  await page.getByText('+ Suggest a plan', { exact: true }).click();
  await page.getByLabel('Plan title', { exact: true }).fill('Next product increment');
  await page.getByLabel('Plan outline', { exact: true }).fill('Build a small improvement on the previously verified work.');
  const taskKey = await page.getByLabel('Task key', { exact: true }).inputValue();
  assert.ok(taskKey.includes(newGate.gate.id), 'new rounds have distinct default task keys');
  await page.getByLabel('Title', { exact: true }).fill('Second round task');
  await page.getByLabel('Objective', { exact: true }).fill('Ship one independently verifiable improvement.');
  await page.getByLabel('Acceptance criteria', { exact: true }).fill('Regression suite passes');
  await page.getByLabel('Depends on keys', { exact: true }).fill('round-1');
  await page.getByRole('button', { name: /Submit plan/ }).click();
  await expect(page.getByRole('heading', { name: 'Next product increment', exact: true })).toBeVisible();
  const gateView = await h.clients.builder.getDecisionGate(newGate.gate.id);
  await h.clients.builder.supportDecisionProposal(newGate.gate.id, gateView.proposals[0].id);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Second round task', exact: true })).toBeVisible();
  await expect(page.getByText('Earlier rounds · 2', { exact: true })).toBeVisible();
  await expect(page.locator('.decision-panel')).toHaveCount(0); // archived history renders only when expanded
  await page.getByText('Earlier rounds · 2', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Next year of improvements', exact: true })).toBeVisible();
  await page.getByText('Earlier rounds · 2', { exact: true }).click();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/mission-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const contrast = await page.evaluate(() => {
    const luminance = (css) => {
      const rgb = css.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const bg = luminance(getComputedStyle(document.querySelector('.mission-progress-panel')).backgroundColor);
    return ['.mission-progress-note', '.mission-repo a', '.mission-continuity'].map((selector) => {
      const fg = luminance(getComputedStyle(document.querySelector(selector)).color);
      return { selector, ratio: (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05) };
    });
  });
  for (const item of contrast) assert.ok(item.ratio >= 4.5, `${item.selector} dark contrast: ${item.ratio}`);
  await page.screenshot({ path: 'test-results/mission-dark.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile page must not overflow');
  await page.screenshot({ path: 'test-results/mission-mobile.png', fullPage: true });
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('Verified: real React mutations, two repository links, complete/reopen, follow-up plan and dependency, history, reduced motion, dark mode and mobile layout.');
});
