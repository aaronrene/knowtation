/**
 * Seven-tier contracts for HUB-DASH-IA-d (mobile bottom nav + How-to copy sync).
 * Ground truth: docs/reviews/2026-07-29-hub-dashboard-ia.md (expert item 20 + copy/BV).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hubMobileBottomNavOrder,
  hubMobileMoreActions,
  hubPrimaryRailOrder,
  hubCriticalDataTabs,
  clampProposedBadgeCount,
  formatProposedBadgeText,
  shouldPulseReviewBadge,
  hubShellLabelForTab,
} from '../web/hub/hub-shell-ia.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const hubHtml = fs.readFileSync(path.join(root, 'web/hub/index.html'), 'utf8');
const hubJs = fs.readFileSync(path.join(root, 'web/hub/hub.js'), 'utf8');
const hubCss = fs.readFileSync(path.join(root, 'web/hub/hub.css'), 'utf8');
const onboarding = fs.readFileSync(path.join(root, 'web/hub/onboarding-wizard.mjs'), 'utf8');

describe('HUB-DASH-IA-d unit', () => {
  it('mobile bottom nav order is Vault | Review | History | More', () => {
    assert.deepEqual(hubMobileBottomNavOrder(), ['Vault', 'Review', 'History', 'More']);
    assert.deepEqual(hubPrimaryRailOrder(), ['Vault', 'Review', 'History']);
    assert.equal(hubShellLabelForTab('suggested'), 'Review');
  });

  it('More sheet lists Import/Connect/Settings/Help (Insights relocated for mobile)', () => {
    const more = hubMobileMoreActions();
    assert.ok(more.includes('Import'));
    assert.ok(more.includes('Connect'));
    assert.ok(more.includes('Settings'));
    assert.ok(more.includes('Help'));
    assert.ok(more.includes('Insights'));
    assert.deepEqual(more, ['Insights', 'Import', 'Connect', 'Settings', 'Help']);
  });
});

describe('HUB-DASH-IA-d integration (source wiring)', () => {
  it('bottom Review uses data-tab=suggested; History opens History mode; More actions share secondary runner', () => {
    assert.match(hubHtml, /id="hub-bottom-review"[^>]*data-tab="suggested"/);
    assert.match(hubHtml, /id="hub-bottom-vault"[^>]*data-tab="notes"/);
    assert.match(hubHtml, /id="hub-bottom-history"[^>]*data-hub-mode="history"/);
    assert.match(hubJs, /hub-bottom-history[\s\S]{0,200}openHistoryMode\s*\(/);
    assert.match(hubJs, /function\s+runHubSecondaryAction\s*\(/);
    assert.match(hubJs, /data-hub-more-action[\s\S]{0,300}runHubSecondaryAction/);
    assert.match(
      hubJs,
      /key\s*===\s*['"]connect['"][\s\S]{0,200}openSettingsIntegrationsTab\s*\(/,
    );
  });

  it('badge updates include hub-bottom-review-badge with rail/header', () => {
    assert.match(
      hubJs,
      /\[['"]hub-review-badge['"],\s*['"]hub-header-review-badge['"],\s*['"]hub-bottom-review-badge['"]\]/,
    );
    assert.match(hubHtml, /id="hub-bottom-review-badge"/);
  });
});

describe('HUB-DASH-IA-d e2e static contract', () => {
  it('bottom nav markup order Vault → Review → History → More', () => {
    const nav = hubHtml.match(/id="hub-bottom-nav"[\s\S]*?<\/nav>/);
    assert.ok(nav, 'hub-bottom-nav present');
    const chunk = nav[0];
    const vault = chunk.indexOf('>Vault<');
    const review = chunk.indexOf('>Review');
    const history = chunk.indexOf('>History<');
    const more = chunk.indexOf('>More<');
    assert.ok(vault >= 0 && review > vault && history > review && more > history);
  });

  it('More sheet has Import, Connect, Settings, Help actions', () => {
    assert.match(hubHtml, /id="hub-more-sheet"/);
    for (const action of ['import', 'connect', 'settings', 'help']) {
      assert.match(hubHtml, new RegExp('data-hub-more-action="' + action + '"'));
    }
  });

  it('How-to / onboarding copy uses Review glossary and History segments (no Suggested queue label)', () => {
    assert.match(onboarding, /Proposals and the Review queue/);
    assert.match(onboarding, /mobile bottom nav/);
    assert.match(hubHtml, /History → Discarded/);
    assert.match(hubHtml, /History → Activity/);
    assert.match(hubHtml, /Vault browse \+ Insights/);
    assert.doesNotMatch(hubHtml, /Discarded tab:/);
    assert.doesNotMatch(hubHtml, /Activity tab:/);
    assert.doesNotMatch(hubHtml, />Suggested</);
    assert.doesNotMatch(onboarding, /Suggested queue/);
    assert.doesNotMatch(onboarding, /the Suggested/);
  });
});

describe('HUB-DASH-IA-d stress', () => {
  it('bottom badge helpers safe for proposed count 0–100', () => {
    for (let i = 0; i <= 100; i++) {
      assert.equal(clampProposedBadgeCount(i), i);
      const t = formatProposedBadgeText(i);
      if (i === 0) assert.equal(t, '');
      else assert.equal(t, String(i));
    }
    assert.equal(shouldPulseReviewBadge(0, 1), true);
  });
});

describe('HUB-DASH-IA-d data-integrity', () => {
  it('critical data-tab values unchanged; bottom nav does not rename hooks', () => {
    assert.deepEqual(hubCriticalDataTabs(), ['notes', 'suggested', 'activity', 'problem']);
    for (const tab of hubCriticalDataTabs()) {
      assert.match(hubHtml, new RegExp('data-tab="' + tab + '"'));
      assert.match(hubHtml, new RegExp('id="tab-' + tab + '"'));
    }
    for (const id of [
      'btn-header-suggested',
      'proposals-suggested',
      'btn-import',
      'btn-settings',
      'btn-how-to-use',
      'modal-import',
      'modal-settings',
      'modal-how-to-use',
      'modal-onboarding',
      'hub-rail-connect',
      'hub-bottom-nav',
    ]) {
      assert.match(hubHtml, new RegExp('id="' + id + '"'));
    }
  });
});

describe('HUB-DASH-IA-d performance (mobile chrome disclosure)', () => {
  it('CSS hides left rail and shows fixed bottom nav at ≤768px', () => {
    assert.match(hubCss, /@media\s*\(\s*max-width:\s*768px\s*\)/);
    assert.match(hubCss, /\.hub-rail\s*\{\s*display:\s*none/);
    assert.match(hubCss, /\.hub-bottom-nav\s*\{[^}]*display:\s*flex/s);
    assert.match(hubCss, /\.hub-bottom-nav\s*\{[^}]*position:\s*fixed/s);
    assert.match(hubCss, /\.hub-bottom-nav\s*\{\s*display:\s*none/);
  });
});

describe('HUB-DASH-IA-d security', () => {
  it('More actions use text labels; badge textContent; approve/discard contracts unchanged', () => {
    assert.match(hubJs, /badge\.textContent\s*=/);
    assert.doesNotMatch(hubJs, /hub-bottom-review-badge[\s\S]{0,80}innerHTML\s*=/);
    assert.doesNotMatch(hubJs, /data-hub-more-action[\s\S]{0,120}innerHTML\s*=/);
    assert.match(hubJs, /\/api\/v1\/proposals\/['"]\s*\+\s*encodeURIComponent\(id\)\s*\+\s*['"]\/approve/);
    assert.match(hubJs, /\/api\/v1\/proposals\/['"]\s*\+\s*encodeURIComponent\(id\)\s*\+\s*['"]\/discard/);
  });
});
