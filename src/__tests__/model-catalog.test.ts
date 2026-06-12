import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toSkillCommandOptions } from '../model-catalog';

describe('model catalog slash commands', () => {
  it('maps only pi skill commands to slash command options', () => {
    const options = toSkillCommandOptions([
      {
        name: 'skill:review',
        description: 'Review code',
        source: 'skill',
      },
      {
        name: 'template',
        description: 'Prompt template',
        source: 'prompt',
      },
      {
        name: 'extension-cmd',
        description: 'Extension command',
        source: 'extension',
      },
    ]);

    assert.deepEqual(options, [
      {
        id: 'skill:review',
        name: 'skill:review',
        label: 'skill:review',
        description: 'Review code',
        category: 'skill',
      },
    ]);
  });
});
