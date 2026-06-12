import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createWorkDirMessage, getInitialWorkDir } from '../utils/workdir-utils';

describe('workdir utils', () => {
  it('uses the vault path as the initial work directory', () => {
    assert.equal(getInitialWorkDir('E:\\vault\\notes'), 'E:\\vault\\notes');
  });

  it('falls back to an empty work directory when no vault path is available', () => {
    assert.equal(getInitialWorkDir(undefined), '');
  });

  it('creates a local-only system message for directory switches', () => {
    const message = createWorkDirMessage('E:\\vault\\notes\\project');

    assert.equal(message.role, 'system');
    assert.equal(message.content, '工作目录已切换到：E:\\vault\\notes\\project');
    assert.match(message.id, /^workdir-/);
  });
});
