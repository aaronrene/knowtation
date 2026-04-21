import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ONBOARDING_LS_KEY,
  DOCS_BASE,
  LLM_SELF_HELP_EXPORT_PROMPT,
  parseOnboardingState,
  serializeOnboardingState,
  createFreshState,
  getStepCount,
  shouldAutoOpenWizard,
  getStepContent,
  getStepSecondaryActions,
} from '../web/hub/onboarding-wizard.mjs';

describe('onboarding-wizard.mjs', () => {
  it('exports a stable localStorage key', () => {
    assert.equal(ONBOARDING_LS_KEY, 'knowtation_onboarding_v1');
  });

  it('parseOnboardingState rejects invalid JSON and wrong shape', () => {
    assert.equal(parseOnboardingState(null), null);
    assert.equal(parseOnboardingState(''), null);
    assert.equal(parseOnboardingState('not json'), null);
    assert.equal(parseOnboardingState('{}'), null);
    assert.equal(parseOnboardingState(JSON.stringify({ v: 2, userKey: 'x', hostingPath: 'hosted', status: 'in_progress', stepIndex: 0 })), null);
  });

  it('round-trips a valid state', () => {
    const s = createFreshState('google:abc', 'hosted');
    s.stepIndex = 2;
    const raw = serializeOnboardingState(s);
    const back = parseOnboardingState(raw);
    assert.ok(back);
    assert.equal(back.userKey, 'google:abc');
    assert.equal(back.hostingPath, 'hosted');
    assert.equal(back.stepIndex, 2);
    assert.equal(back.status, 'in_progress');
  });

  it('getStepCount matches hosted vs self-hosted flows', () => {
    assert.equal(getStepCount(true), 9);
    assert.equal(getStepCount(false), 5);
  });

  it('exports docs base and a non-trivial LLM export helper prompt', () => {
    assert.ok(DOCS_BASE.includes('github.com'));
    assert.ok(LLM_SELF_HELP_EXPORT_PROMPT.includes('Knowtation'));
    assert.ok(LLM_SELF_HELP_EXPORT_PROMPT.length > 120);
  });

  it('shouldAutoOpenWizard: null state opens; dismissed/completed do not; in_progress opens', () => {
    assert.equal(shouldAutoOpenWizard(null, 'u1', 'hosted'), true);
    const dismissed = createFreshState('u1', 'hosted');
    dismissed.status = 'dismissed';
    assert.equal(shouldAutoOpenWizard(dismissed, 'u1', 'hosted'), false);
    const done = createFreshState('u1', 'hosted');
    done.status = 'completed';
    assert.equal(shouldAutoOpenWizard(done, 'u1', 'hosted'), false);
    const prog = createFreshState('u1', 'hosted');
    prog.stepIndex = 2;
    assert.equal(shouldAutoOpenWizard(prog, 'u1', 'hosted'), true);
  });

  it('shouldAutoOpenWizard: user or hosting change forces reopen', () => {
    const st = createFreshState('u1', 'hosted');
    st.status = 'dismissed';
    assert.equal(shouldAutoOpenWizard(st, 'u2', 'hosted'), true);
    const st2 = createFreshState('u1', 'hosted');
    st2.status = 'completed';
    assert.equal(shouldAutoOpenWizard(st2, 'u1', 'selfhosted'), true);
  });

  it('getStepContent returns plain-language blocks for each hosted step', () => {
    for (let i = 0; i < 9; i++) {
      const c = getStepContent(true, i);
      assert.ok(c && c.id && c.title && c.bodyHtml.length > 20);
    }
    assert.equal(getStepContent(true, 3).id, 'h-imports');
    assert.equal(getStepContent(true, 99), null);
  });

  it('getStepSecondaryActions lists expected hosted shortcuts', () => {
    assert.ok(getStepSecondaryActions(true, 0).some((a) => a.id === 'openWhyTokenDoc'));
    assert.ok(getStepSecondaryActions(true, 2).some((a) => a.id === 'openSettingsIntegrations'));
    assert.ok(getStepSecondaryActions(true, 3).some((a) => a.id === 'openImportModal'));
    assert.ok(getStepSecondaryActions(true, 4).some((a) => a.id === 'focusSuggestedTab'));
    assert.ok(getStepSecondaryActions(true, 5).some((a) => a.id === 'projectsHelp'));
    assert.ok(getStepSecondaryActions(true, 8).some((a) => a.id === 'openAgentIntegrationDoc'));
  });

  it('getStepSecondaryActions lists self-hosted doc jumps', () => {
    assert.ok(getStepSecondaryActions(false, 1).some((a) => a.id === 'howToSetup4'));
    assert.ok(getStepSecondaryActions(false, 2).some((a) => a.id === 'howToSetup3'));
  });
});
