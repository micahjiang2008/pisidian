import type { Message } from '../types';

export function getInitialWorkDir(vaultPath?: string): string {
  return vaultPath ?? '';
}

export function createWorkDirMessage(workDir: string): Message {
  return {
    id: `workdir-${Date.now()}`,
    role: 'system',
    content: `工作目录已切换到：${workDir || '(未设置)'}`,
    timestamp: Date.now(),
  };
}
