/**
 * Seven-tier contracts for HUB-DASH-IA-c (Review inbox + Vault search + Insights).
 * Ground truth: docs/reviews/2026-07-29-hub-dashboard-ia.md (expert items 2–6, 8, 13, 17).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hubChromeVisibility,
  formatRelativeTime,
  reviewRowNeedsPendingEvalChip,
  formatReviewSplitPosition,
  shouldExpandVaultAdvancedFilters,
  emptyReviewPrimaryCtaLabel,
  emptyReviewSecondaryCtaLabel,
  shouldShowPendingEvalQuickChip,
  clampListKeyboardIndex,
  hubCriticalDataTabs,
} from '../web/hub/hub-shell-ia.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const hubHtml = fs.readFileSync(path.join(root, 'web/hub/index.html'), 'utf8');
const hubJs = fs.readFileSync(path.join(root, 'web/hub/hub.js'), 'utf8');
const hubCss = fs.readFileSync(path.join(root, 'web/hub/hub.css'), 'utf8');

describe('HUB-DASH-IA-c unit', () => {
  it('chrome visibility: Review hides note search; Vault shows; Insights hides search', () => {
    assert.deepEqual(hubChromeVisibility('suggested', 'list'), {
      noteSearch: false,
      browseToolbar: false,
      proposalFilters: true,
      insights: false,
    });
    assert.deepEqual(hubChromeVisibility('notes', 'list'), {
      noteSearch: true,
      browseToolbar: true,
      proposalFilters: false,
      insights: false,
    });
    assert.deepEqual(hubChromeVisibility('notes', 'graph'), {
      noteSearch: false,
      browseToolbar: false,
      proposalFilters: false,
      insights: true,
    });
    assert.equal(hubChromeVisibility('activity', 'list').proposalFilters, true);
  });

  it('relative time + pending-eval chip + N of M + keyboard clamp', () => {
    const now = Date.parse('2026-07-29T12:00:00Z');
    assert.equal(formatRelativeTime('2026-07-29T11:59:30Z', now), 'just now');
    assert.equal(formatRelativeTime('2026-07-29T11:00:00Z', now), '1h ago');
    assert.equal(formatRelativeTime('2026-07-28T12:00:00Z', now), '1d ago');
    assert.equal(formatRelativeTime('', now), '');
    assert.equal(reviewRowNeedsPendingEvalChip('pending'), true);
    assert.equal(reviewRowNeedsPendingEvalChip('pass'), false);
    assert.equal(formatReviewSplitPosition(3, 12), '3 of 12');
    assert.equal(formatReviewSplitPosition(0, 5), '');
    assert.equal(clampListKeyboardIndex(99, 5), 4);
    assert.equal(clampListKeyboardIndex(-1, 5), 0);
    assert.equal(clampListKeyboardIndex(1, 0), 0);
  });

  it('empty Review CTAs and pending-eval quick chip policy', () => {
    assert.equal(emptyReviewPrimaryCtaLabel(), 'New proposal');
    assert.equal(emptyReviewSecondaryCtaLabel(), 'How Review works');
    assert.equal(shouldShowPendingEvalQuickChip(true), true);
    assert.equal(shouldShowPendingEvalQuickChip(false), false);
    assert.equal(shouldExpandVaultAdvancedFilters(false, false), false);
    assert.equal(shouldExpandVaultAdvancedFilters(true, false), true);
    assert.equal(shouldExpandVaultAdvancedFilters(false, true), true);
  });
});

describe('HUB-DASH-IA-c integration (source wiring)', () => {
  it('syncModeToolbars hides search on Review and wires Insights → graph + consolidation', () => {
    assert.match(hubJs, /function\s+syncModeToolbars\s*\(/);
    assert.match(hubJs, /hubChromeVisibility\s*\(/);
    assert.match(hubJs, /hub-rail-insights[\s\S]{0,300}switchNotesView\(\s*['"]graph['"]\s*\)/);
    assert.match(hubJs, /view\s*===\s*['"]graph['"][\s\S]{0,120}refreshConsolidationCard/);
    assert.match(hubHtml, /id="consolidation-card"/);
    assert.match(hubHtml, /id="notes-view-graph"/);
    assert.match(hubHtml, /data-view="graph"/);
  });

  it('Review empty CTAs + pending-eval chip toggle filter', () => {
    assert.match(hubJs, /empty-suggested-new/);
    assert.match(hubJs, /How Review works|emptyReviewSecondaryCtaLabel/);
    assert.match(hubHtml, /id="proposal-pending-eval-chip"/);
    assert.match(hubJs, /proposal-pending-eval-chip[\s\S]{0,400}proposal-filter-pending-eval/);
    assert.match(hubJs, /id="empty-suggested-how-to"/);
  });

  it('primary actions / eval sit above diffs; detail-actions before body wrap', () => {
    const detail = hubHtml.match(/id="detail-panel"[\s\S]*?<\/aside>/);
    assert.ok(detail);
    const actionsAt = detail[0].indexOf('id="detail-actions"');
    const bodyAt = detail[0].indexOf('detail-body-wrap');
    assert.ok(actionsAt >= 0 && bodyAt > actionsAt, 'detail-actions must precede detail-body-wrap');
    assert.match(hubJs, /proposal-primary-eval/);
    assert.match(hubJs, /primaryEvalBlock[\s\S]{0,200}proposal-diff-grid/);
  });
});

describe('HUB-DASH-IA-c e2e static contract', () => {
  it('Vault search-first command bar; advanced filters in collapsed details', () => {
    assert.match(hubHtml, /id="hub-search-section"/);
    assert.match(hubHtml, /id="hub-search-advanced"/);
    assert.match(hubHtml, /class="search-row search-row-primary"/);
    const adv = hubHtml.match(/id="hub-search-advanced"[\s\S]*?<\/details>/);
    assert.ok(adv);
    assert.match(adv[0], /id="filter-project"/);
    assert.match(adv[0], /id="btn-apply-filters"/);
    assert.match(adv[0], /id="btn-reindex"/);
    // Primary row keeps Meaning/Keyword + Search/Clear
    const primary = hubHtml.match(/search-row-primary[\s\S]*?<\/div>/);
    assert.ok(primary);
    assert.match(primary[0], /id="search-query"/);
    assert.match(primary[0], /id="search-mode"/);
    assert.match(primary[0], /id="btn-search"/);
    assert.match(primary[0], /id="btn-clear-search"/);
    assert.doesNotMatch(primary[0], /id="filter-project"/);
  });

  it('Review row density hooks + split position + keyboard arrows', () => {
    assert.match(hubJs, /review-row/);
    assert.match(hubJs, /proposal-chip-pending-eval|Pending eval/);
    assert.match(hubJs, /formatRelativeTime/);
    assert.match(hubHtml, /id="detail-split-position"/);
    assert.match(hubJs, /ArrowDown/);
    assert.match(hubJs, /ArrowUp/);
    assert.match(hubJs, /updateProposalListSelection/);
  });
});

describe('HUB-DASH-IA-c stress', () => {
  it('relative time and N-of-M safe across large indices', () => {
    const now = Date.now();
    for (let i = 0; i < 200; i++) {
      const iso = new Date(now - i * 3600_000).toISOString();
      const t = formatRelativeTime(iso, now);
      assert.equal(typeof t, 'string');
      assert.ok(t.length > 0);
    }
    for (let n = 1; n <= 100; n++) {
      assert.equal(formatReviewSplitPosition(n, 100), n + ' of 100');
      assert.equal(clampListKeyboardIndex(n + 50, n), n - 1);
    }
  });
});

describe('HUB-DASH-IA-c data-integrity', () => {
  it('critical search/proposal/detail IDs and data-tab values preserved', () => {
    assert.deepEqual(hubCriticalDataTabs(), ['notes', 'suggested', 'activity', 'problem']);
    const ids = [
      'search-query',
      'search-mode',
      'btn-search',
      'btn-clear-search',
      'btn-apply-filters',
      'btn-reindex',
      'hub-index-status',
      'browse-toolbar',
      'proposal-filters-bar',
      'proposal-filter-pending-eval',
      'btn-new-proposal',
      'proposals-suggested',
      'detail-panel',
      'detail-actions',
      'detail-body',
      'consolidation-card',
      'hub-rail-insights',
    ];
    for (const id of ids) {
      assert.match(hubHtml, new RegExp('id="' + id + '"'));
    }
    // empty-suggested-how-to / proposal-eval IDs are injected in JS for empty/detail states
    assert.match(hubJs, /empty-suggested-how-to/);
    assert.match(hubJs, /proposal-eval-save/);
    assert.match(hubJs, /proposal-waiver-reason/);
    assert.match(hubJs, /proposal-open-note-btn/);
    assert.match(hubJs, /\/api\/v1\/proposals\/['"]\s*\+\s*encodeURIComponent\(id\)\s*\+\s*['"]\/approve/);
    assert.match(hubJs, /\/api\/v1\/proposals\/['"]\s*\+\s*encodeURIComponent\(id\)\s*\+\s*['"]\/discard/);
  });
});

describe('HUB-DASH-IA-c performance', () => {
  it('advanced filters default-collapsed; Review does not mount note filter row', () => {
    assert.equal(shouldExpandVaultAdvancedFilters(false, false), false);
    const detailsOpen = /id="hub-search-advanced"[^>]*\sopen[\s>]/;
    assert.doesNotMatch(hubHtml, detailsOpen);
    assert.match(hubJs, /syncModeToolbars/);
    assert.match(hubCss, /\.search-section\.hidden/);
    // Review chrome: noteSearch false when suggested
    assert.equal(hubChromeVisibility('suggested').noteSearch, false);
  });
});

describe('HUB-DASH-IA-c security', () => {
  it('row/empty state use escapeHtml; no RBAC contract changes; no secrets', () => {
    assert.match(hubJs, /escapeHtml\(primaryCta\)|escapeHtml\(secondaryCta\)/);
    assert.match(hubJs, /escapeHtml\(rel\)|escapeHtml\(p\.path\)/);
    assert.doesNotMatch(hubJs, /proposal-pending-eval-chip[\s\S]{0,80}innerHTML\s*=/);
    assert.match(hubJs, /canApprove\s*=\s*isAdmin\s*\|\|\s*\(isEvaluator\s*&&\s*window\.__hubEvaluatorMayApprove\)/);
    assert.match(hubJs, /canDiscard\s*=\s*isAdmin/);
    assert.doesNotMatch(hubHtml + hubJs, /sk-[a-zA-Z0-9]{20,}/);
    assert.doesNotMatch(hubHtml + hubJs, /BEGIN (RSA |OPENSSH )?PRIVATE KEY/);
  });
});
