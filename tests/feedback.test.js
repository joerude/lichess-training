import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageFeedback } from '../extension/ui/page.js';

function feedbackFixture() {
  const errorBox = { hidden: true, textContent: '' };
  const notice = { hidden: true, textContent: '' };
  return { errorBox, notice, feedback: createPageFeedback({ errorBox, notice }) };
}

test('a recovered snapshot clears its prior load error', () => {
  const { errorBox, feedback } = feedbackFixture();
  feedback.showError(new Error('Storage unavailable'), 'training.getSnapshot');
  assert.equal(errorBox.hidden, false);
  feedback.recoveredSnapshot();
  assert.equal(errorBox.hidden, true);
});

test('automatic snapshot recovery preserves actionable export and restore errors', () => {
  for (const source of [undefined, 'training.import', 'training.setCompletion']) {
    const { errorBox, feedback } = feedbackFixture();
    feedback.showError(new Error('Failed action'), source);
    feedback.recoveredSnapshot();
    assert.equal(errorBox.hidden, false);
    assert.match(errorBox.textContent, /Failed action/);
  }
});

test('persisted action success replaces an earlier error with confirmation', () => {
  const { errorBox, notice, feedback } = feedbackFixture();
  feedback.showError(new Error('Failed action'), 'training.import');
  feedback.showSuccess('Saved');
  assert.equal(errorBox.hidden, true);
  assert.equal(notice.hidden, false);
  assert.equal(notice.textContent, 'Saved');
});
