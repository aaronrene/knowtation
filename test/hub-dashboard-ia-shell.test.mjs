/**
 * Seven-tier contracts for HUB-DASH-IA-b (signed-in Hub shell IA).
 * Ground truth: docs/reviews/2026-07-29-hub-dashboard-ia.md
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hubShellLabelForTab,
  HUB_SHELL_LABELS,
  normalizeHistorySegment,
  readHistorySegment,
  writeHistorySegment,
  clampProposedBadgeCount,
  formatProposedBadgeText,
  shouldShowNeedsYouBanner,
  needsYouBannerCopy,
  shouldPulseReviewBadge,
  hubPrimaryRailOrder,
  hubCriticalDataTabs,
  HUB_HISTORY_SEGMENT_KEY,
  HUB_NEEDS_YOU_DISMISS_KEY,
} from '../web/hub/hub-shell-ia.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const hubHtml = fs.readFileSync(path.join(root, 'web/hub/index.html'), 'utf8');
const hubJs = fs.readFileSync(path.join(root, 'web/hub/hub.js'), 'utf8');
const hubCss = fs.readFileSync(path.join(root, 'web/hub/hub.css'), 'utf8');
const onboarding = fs.readFileSync(path.join(root, 'web/hub/onboarding-wizard.mjs'), 'utf8');

describe('HUB-DASH-IA-b unit', () => {
  it('label map uses Review for suggested queue (not Suggested)', () => {
    assert.equal(hubShellLabelForTab('suggested'), 'Review');
    assert.equal(hubShellLabelForTab('notes'), 'Vault');
    assert.equal(hubShellLabelForTab('activity'), 'Activity');
    assert.equal(hubShellLabelForTab('problem'), 'Discarded');
    assert.equal(HUB_SHELL_LABELS.suggested, 'Review');
  });

  it('History segment helpers default to activity and persist problem', () => {
    assert.equal(normalizeHistorySegment(undefined), 'activity');
    assert.equal(normalizeHistorySegment('problem'), 'problem');
    assert.equal(normalizeHistorySegment('activity'), 'activity');
    const store = {
      _m: new Map(),
      getItem(k) {
        return this._m.has(k) ? this._m.get(k) : null;
      },
      setItem(k, v) {
        this._m.set(k, String(v));
      },
    };
    assert.equal(readHistorySegment(store), 'activity');
    writeHistorySegment('problem', store);
    assert.equal(store.getItem(HUB_HISTORY_SEGMENT_KEY), 'problem');
    assert.equal(readHistorySegment(store), 'problem');
  });

  it('badge count is unfiltered proposed clamp, independent of list filters', () => {
    assert.equal(clampProposedBadgeCount(0), 0);
    assert.equal(clampProposedBadgeCount(3), 3);
    assert.equal(clampProposedBadgeCount(100), 100);
    assert.equal(clampProposedBadgeCount(101), 100);
    assert.equal(clampProposedBadgeCount(-1), 0);
    assert.equal(formatProposedBadgeText(0), '');
    assert.equal(formatProposedBadgeText(7), '7');
  });
});

describe('HUB-DASH-IA-b integration (source wiring)', () => {
  it('switchHubMainTab suggested still targets #proposals-suggested / data-tab=suggested', () => {
    assert.match(hubJs, /function\s+switchHubMainTab\s*\(\s*name\s*\)/);
    assert.match(hubJs, /name\s*===\s*['"]suggested['"]\s*\|\|\s*name\s*===\s*['"]problem['"]/);
    assert.match(hubHtml, /id="proposals-suggested"/);
    assert.match(hubHtml, /data-tab="suggested"/);
    assert.match(hubJs, /loadProposals\s*\(/);
  });

  it('History Discarded segment maps to problem via data-tab', () => {
    assert.match(
      hubHtml,
      /data-tab="problem"[^>]*data-history-segment="problem"|data-history-segment="problem"[^>]*data-tab="problem"/,
    );
    assert.match(hubJs, /openHistoryMode/);
    assert.match(hubJs, /readHistorySegment/);
  });

  it('Connect rail calls openSettingsIntegrationsTab()', () => {
    assert.match(hubHtml, /id="hub-rail-connect"/);
    assert.match(hubJs, /function\s+runHubSecondaryAction\s*\(/);
    assert.match(
      hubJs,
      /key\s*===\s*['"]connect['"][\s\S]{0,200}openSettingsIntegrationsTab\s*\(/,
    );
  });
});

describe('HUB-DASH-IA-b e2e static contract', () => {
  it('rail order Vault → Review → History in primary rail', () => {
    const primary = hubHtml.match(/hub-rail-primary[\s\S]*?hub-rail-secondary/);
    assert.ok(primary, 'primary rail markup present');
    const chunk = primary[0];
    const vault = chunk.indexOf('>Vault<');
    const review = chunk.indexOf('>Review');
    const history = chunk.indexOf('>History<');
    assert.ok(vault >= 0 && review > vault && history > review, 'Vault then Review then History');
    assert.deepEqual(hubPrimaryRailOrder(), ['Vault', 'Review', 'History']);
  });

  it('Needs-you banner markup targets Review / suggested', () => {
    assert.match(hubHtml, /id="hub-needs-you-banner"/);
    assert.match(hubHtml, /id="hub-needs-you-open"/);
    assert.match(hubJs, /hub-needs-you-open[\s\S]{0,200}switchHubMainTab\(\s*['"]suggested['"]\s*\)/);
    assert.equal(HUB_NEEDS_YOU_DISMISS_KEY, 'hub_needs_you_dismissed');
    assert.equal(shouldShowNeedsYouBanner(2, false), true);
    assert.equal(shouldShowNeedsYouBanner(2, true), false);
    assert.equal(shouldShowNeedsYouBanner(0, false), false);
    assert.match(needsYouBannerCopy(3), /3 proposals waiting in Review/);
  });

  it('no user-facing Suggested queue/tab label in web/hub chrome', () => {
    const blobs = [hubHtml, hubJs, onboarding];
    for (const blob of blobs) {
      // Allow internal ids / path-typo helpers; forbid queue chrome labels.
      assert.doesNotMatch(blob, />Suggested</);
      assert.doesNotMatch(blob, /Open Suggested tab/);
      assert.doesNotMatch(blob, /Suggested tab/);
      assert.doesNotMatch(blob, /Suggested queue/);
      assert.doesNotMatch(blob, /the Suggested/);
    }
    assert.match(hubHtml, /id="btn-header-suggested"[^>]*>Review/);
  });
});

describe('HUB-DASH-IA-b stress', () => {
  it('badge helpers safe for proposed count 0–100', () => {
    for (let i = 0; i <= 100; i++) {
      assert.equal(clampProposedBadgeCount(i), i);
      const t = formatProposedBadgeText(i);
      if (i === 0) assert.equal(t, '');
      else assert.equal(t, String(i));
    }
    assert.equal(shouldPulseReviewBadge(0, 1), true);
    assert.equal(shouldPulseReviewBadge(5, 5), false);
    assert.equal(shouldPulseReviewBadge(5, 4), false);
  });
});

describe('HUB-DASH-IA-b data-integrity', () => {
  it('critical data-tab values and IDs unchanged', () => {
    assert.deepEqual(hubCriticalDataTabs(), ['notes', 'suggested', 'activity', 'problem']);
    for (const tab of hubCriticalDataTabs()) {
      assert.match(hubHtml, new RegExp('data-tab="' + tab + '"'));
      assert.match(hubHtml, new RegExp('id="tab-' + tab + '"'));
    }
    const ids = [
      'btn-header-suggested',
      'proposals-suggested',
      'proposals-problem',
      'proposals-activity',
      'btn-import',
      'btn-settings',
      'btn-how-to-use',
      'modal-import',
      'modal-settings',
      'modal-how-to-use',
      'hub-list-sort',
      'notes-view-graph',
      'consolidation-card',
      'detail-panel',
    ];
    for (const id of ids) {
      assert.match(hubHtml, new RegExp('id="' + id + '"'));
    }
    assert.match(hubJs, /function\s+openSettingsIntegrationsTab\s*\(/);
  });
});

describe('HUB-DASH-IA-b performance (Vault browse disclosure)', () => {
  it('Vault browse shows List|Calendar only; Overview/graph is Insights (hidden view-tab)', () => {
    const browse = hubHtml.match(/id="browse-toolbar"[\s\S]*?<\/section>/);
    assert.ok(browse);
    const visibleViews = [...browse[0].matchAll(/class="view-tab(?![^"]*hidden)[^"]*"[^>]*data-view="([^"]+)"/g)].map(
      (m) => m[1],
    );
    // Hidden graph tab still present for Insights
    assert.match(browse[0], /data-view="graph"[^>]*class="[^"]*hidden|class="[^"]*hidden[^"]*"[^>]*data-view="graph"/);
    assert.ok(visibleViews.includes('list'));
    assert.ok(visibleViews.includes('calendar'));
    assert.ok(!visibleViews.includes('graph'), 'graph must not be a visible browse segment');
    assert.match(hubHtml, /id="hub-rail-insights"/);
    assert.match(hubJs, /function\s+runHubSecondaryAction\s*\(/);
    assert.match(
      hubJs,
      /key\s*===\s*['"]insights['"][\s\S]{0,200}switchNotesView\(\s*['"]graph['"]\s*\)/,
    );
  });
});

describe('HUB-DASH-IA-b security', () => {
  it('badge/Needs-you use textContent paths; no proposal RBAC changes in shell slice', () => {
    assert.match(hubJs, /badge\.textContent\s*=/);
    assert.match(hubJs, /textEl\.textContent\s*=/);
    assert.doesNotMatch(hubJs, /hub-needs-you-text[\s\S]{0,80}innerHTML\s*=/);
    assert.doesNotMatch(hubJs, /hub-review-badge[\s\S]{0,80}innerHTML\s*=/);
    // Approve/discard still go through existing API helpers (unchanged contracts)
    assert.match(hubJs, /\/api\/v1\/proposals\/['"]\s*\+\s*encodeURIComponent\(id\)\s*\+\s*['"]\/approve/);
    assert.match(hubJs, /\/api\/v1\/proposals\/['"]\s*\+\s*encodeURIComponent\(id\)\s*\+\s*['"]\/discard/);
    assert.match(hubCss, /hub-rail-item\.active::before/);
    assert.match(hubCss, /prefers-reduced-motion/);
  });
});
