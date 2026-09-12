import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contentHash,
  extractArtifactProposals,
  isReadableRelativePath,
  normalizeArtifactPath,
  validateArtifactContent,
} from './chat-policy.mjs';

test('read policy allows ordinary text and rejects sensitive or escaped paths', () => {
  assert.equal(isReadableRelativePath('README.md'), true);
  assert.equal(isReadableRelativePath('.ai-team/TASK.md'), true);
  assert.equal(isReadableRelativePath('../outside.md'), false);
  assert.equal(isReadableRelativePath('.env'), false);
  assert.equal(isReadableRelativePath('.aws/credentials.json'), false);
  assert.equal(isReadableRelativePath('config/client_secret.json'), false);
  assert.equal(isReadableRelativePath('config/token.json'), false);
  assert.equal(isReadableRelativePath('keys/private.pem'), false);
  assert.equal(isReadableRelativePath('.git/config'), false);
  assert.equal(isReadableRelativePath('.claude/worktrees/task/plan.md'), false);
  assert.equal(isReadableRelativePath('.build/generated.txt'), false);
  assert.equal(isReadableRelativePath('node_modules/pkg/README.md'), false);
});

test('artifact policy permits only text files beneath artifacts', () => {
  assert.equal(normalizeArtifactPath('artifacts/plan.md').relativePath, 'artifacts/plan.md');
  assert.throws(() => normalizeArtifactPath('../plan.md'));
  assert.throws(() => normalizeArtifactPath('README.md'));
  assert.throws(() => normalizeArtifactPath('artifacts/../README.md'));
  assert.throws(() => normalizeArtifactPath('artifacts/.hidden/plan.md'));
  assert.throws(() => normalizeArtifactPath('artifacts/run.sh'));
  assert.throws(() => normalizeArtifactPath('artifacts/.gitkeep'));
});

test('artifact proposals are parsed without applying filesystem changes', () => {
  const output = 'Review complete.\n<artifact path="artifacts/proposal.md"># Plan\n</artifact>';
  const proposals = extractArtifactProposals(output, {});
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].path, 'artifacts/proposal.md');
  assert.equal(proposals[0].operation, 'create');
  assert.equal(proposals[0].content, '# Plan');
});

test('content validation and hashes are deterministic', () => {
  assert.equal(validateArtifactContent('plain text'), 'plain text');
  assert.equal(contentHash('same'), contentHash('same'));
  assert.notEqual(contentHash('same'), contentHash('different'));
  assert.throws(() => validateArtifactContent('bad\0value'));
});
