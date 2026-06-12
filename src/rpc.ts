/**
 * RPC 通信模块
 *
 * 维护一个持久化的 pi 子进程（session 模式），多轮对话共享上下文。
 * 支持 prompt 命令的发送和流式响应收集（文本 / thinking / 工具调用）。
 */

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Message, MessageRole, MessageStatus } from './types';

// ---- Types ----

interface PiRpcEvent {
  type: string;
  [key: string]: unknown;
}

/** 流式响应中的结构化片段 */
export interface StreamSegment {
  type: 'thinking' | 'tool_call' | 'tool_result';
  text: string;
  toolName?: string;
  toolCallId?: string;
  status?: 'running' | 'success' | 'error';
  isError?: boolean;
}

/** sendMessage() 的返回值 */
export interface SendMessageResult {
  /** assistant 的完整回复文本（不含 thinking） */
  text: string;
  /** 所有结构化片段（thinking 块、工具调用、工具结果） */
  segments: StreamSegment[];
  /** 会话统计（来自 get_session_stats + get_state） */
  stats?: SessionStats;
}

/** 会话统计信息 */
export interface SessionStats {
  /** 模型名称 */
  modelLabel?: string;
  /** 输入 tokens */
  inputTokens?: number;
  /** 输出 tokens */
  outputTokens?: number;
  /** 累计费用 */
  cost?: number;
  /** 上下文使用百分比（如 15.6） */
  contextPercent?: number;
  /** 上下文窗口大小 */
  contextWindow?: number;
}

/** 会话列表项 */
export interface SessionInfo {
  /** session 文件绝对路径 */
  path: string;
  /** session ID（文件名不带扩展名） */
  id: string;
  /** 显示名称（来自 session 元数据） */
  name?: string;
  /** 会话标题（来自 session 元数据或首条用户消息） */
  title?: string;
  /** 最后修改时间 */
  mtime: number;
  /** 消息数量 */
  messageCount?: number;
}

/** sendMessage() 的选项 */
export interface SendMessageOptions {
  /** 超时毫秒数（默认 60 秒） */
  timeoutMs?: number;
  /** 流式文本回调（只含 text_delta，不含 thinking） */
  onDelta?: (delta: string) => void;
  /** 结构化片段回调（thinking 结束、工具执行完毕时触发） */
  onSegment?: (segment: StreamSegment) => void;
  /** 用于提前中止的 AbortSignal */
  signal?: AbortSignal;
}

// ---- Internal helpers ----

function findPiCommand(): string {
  const appData = process.env.APPDATA;
  const userProfile = process.env.USERPROFILE;
  const candidates = [
    'pi',
    appData ? `${appData}\\npm\\pi.cmd` : undefined,
    userProfile ? `${userProfile}\\AppData\\Roaming\\npm\\pi.cmd` : undefined,
  ].filter((cmd): cmd is string => Boolean(cmd));

  return candidates[0] ?? 'pi';
}

function getStringField(source: unknown, keys: string[]): string | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const record = source as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return undefined;
}

function getNestedStringField(
  source: unknown,
  objectKeys: string[],
  stringKeys: string[],
): string | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const record = source as Record<string, unknown>;

  for (const objectKey of objectKeys) {
    const value = getStringField(record[objectKey], stringKeys);
    if (value) return value;
  }

  return undefined;
}

function getSessionDisplayName(event: unknown): string | undefined {
  return (
    getStringField(event, ['sessionName', 'sessionTitle', 'title', 'name']) ??
    getNestedStringField(event, ['session', 'metadata', 'meta'], ['sessionName', 'sessionTitle', 'title', 'name'])
  );
}

function getMessagePreview(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const record = event as Record<string, unknown>;

  if (Array.isArray(record.messages)) {
    for (const item of record.messages) {
      const text = getMessagePreview(item);
      if (text) return text;
    }
  }

  const role = getStringField(record, ['role']);
  const content = valueToText(record.content ?? record.text ?? record.message);
  if ((role === 'user' || role === 'assistant' || role === 'system') && content) return content;

  const message = record.message;
  const nestedRole = getStringField(message, ['role']);
  const nestedContent = message && typeof message === 'object'
    ? valueToText((message as Record<string, unknown>).content ?? (message as Record<string, unknown>).text)
    : '';
  if ((nestedRole === 'user' || nestedRole === 'assistant' || nestedRole === 'system') && nestedContent) {
    return nestedContent;
  }

  if (record.type === 'prompt' && content) return content;

  return undefined;
}

function formatSessionListTitle(value: string): string {
  const firstLine = value.split(/\r?\n/)[0] ?? '';
  const cleaned = firstLine.replace(/\s+/g, '').trim();
  return Array.from(cleaned).slice(0, 20).join('');
}

function valueToText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          return valueToText(record.text ?? record.content ?? record.message);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function normalizeMessageRole(value: unknown): MessageRole | undefined {
  if (typeof value !== 'string') return undefined;
  if (
    value === 'user' ||
    value === 'assistant' ||
    value === 'system' ||
    value === 'tool' ||
    value === 'thinking' ||
    value === 'error'
  ) {
    return value;
  }
  return undefined;
}

function normalizeMessageStatus(value: unknown): MessageStatus | undefined {
  if (
    value === 'pending' ||
    value === 'running' ||
    value === 'success' ||
    value === 'error'
  ) {
    return value;
  }
  return undefined;
}

function timestampFromValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function directMessageFromRecord(
  record: Record<string, unknown>,
  id: string,
  fallbackTimestamp: number,
): Message | null {
  const nested = record.message && typeof record.message === 'object'
    ? record.message as Record<string, unknown>
    : undefined;
  const source = nested ?? record;
  const role =
    normalizeMessageRole(source.role) ??
    (record.type === 'user_message' ? 'user' : undefined) ??
    (record.type === 'assistant_message' ? 'assistant' : undefined) ??
    (record.type === 'system_message' ? 'system' : undefined) ??
    (record.type === 'tool_message' ? 'tool' : undefined);

  if (!role) return null;

  const content = valueToText(source.content ?? source.text ?? source.message);
  if (!content) return null;

  return {
    id,
    role,
    content,
    timestamp: timestampFromValue(
      source.timestamp ?? source.createdAt ?? source.created_at ?? record.timestamp,
      fallbackTimestamp,
    ),
    type: typeof source.type === 'string' ? source.type : undefined,
    toolCallId: typeof source.toolCallId === 'string' ? source.toolCallId : undefined,
    toolName: typeof source.toolName === 'string' ? source.toolName : undefined,
    status: normalizeMessageStatus(source.status),
  };
}

function toolResultText(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const content = (result as Record<string, unknown>).content;
  return valueToText(content);
}

// ---- PiSession: 持久化 pi 进程管理器 ----

/**
 * 管理一个持久化的 pi RPC 子进程，支持 session 模式的多轮对话。
 *
 * 用法：
 *   const session = new PiSession(vaultPath);
 *   await session.fetchStats();           // 初始化获取模型信息
 *   await session.sendMessage("hello");   // 发送消息（可多次调用）
 *   session.abort();                      // 中止当前操作
 *   session.dispose();                    // 销毁进程
 */
export class PiSession {
  private vaultPath: string;
  private child: ChildProcess | null = null;
  private buffer = '';
  private stderrTail = '';
  private lastEventType = '';
  private lastEventAt = 0;
  private lastRawLine = '';

  // 缓存的会话统计
  private _stats: SessionStats = {};

  // 当前 session 文件路径（来自 get_state）
  private _sessionFile: string | null = null;
  private _activeSessionFile: string | null = null;

  // 当前消息的 Promise 调度
  private currentResolve: ((result: SendMessageResult) => void) | null = null;
  private currentReject: ((error: Error) => void) | null = null;
  private currentTimer: ReturnType<typeof setTimeout> | null = null;
  private currentSignalAbortHandler: (() => void) | null = null;
  private currentSignal: AbortSignal | null = null;
  private ensureProcessPromise: Promise<void> | null = null;

  // 当前消息的累积状态
  private fullText = '';
  private segments: StreamSegment[] = [];
  private currentOnDelta: ((delta: string) => void) | undefined;
  private currentOnSegment: ((segment: StreamSegment) => void) | undefined;
  private currentThinking = '';
  private currentToolCallId = '';
  private currentToolName = '';

  // 统计查询状态（在 agent_end 之后查询）
  private pendingStats = false;
  private statsCollected = 0;

  // 通用命令回调（用于 newSession 等非消息类命令）
  private pendingCommandResolve: ((() => void) | null) = null;

  constructor(vaultPath?: string) {
    this.vaultPath = vaultPath ?? '';
  }

  /** 获取当前缓存的统计信息 */
  get stats(): SessionStats {
    return this._stats;
  }

  /** 当前 session 文件路径 */
  get sessionFile(): string | null {
    return this._activeSessionFile ?? this._sessionFile;
  }

  // ---- 公开 API ----

  /**
   * 向 pi 发送一条消息，等待流式响应结束。
   * 如果进程不存在则自动创建；如果正在处理中则拒绝。
   */
  async sendMessage(
    message: string,
    options?: SendMessageOptions,
  ): Promise<SendMessageResult> {
    // 如果有正在处理的消息，拒绝
    if (this.currentResolve) {
      throw new Error('PiSession is already processing a message');
    }
    // 如果有正在执行的命令（如 newSession），拒绝
    if (this.pendingCommandResolve) {
      throw new Error('PiSession is executing a command, wait for completion');
    }

    // 如果已经 abort，直接拒绝
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    await this.ensureProcess();

    const { timeoutMs = 60_000, onDelta, onSegment, signal } = options ?? {};

    return new Promise((resolve, reject) => {
      this.currentResolve = resolve;
      this.currentReject = reject;
      this.currentOnDelta = onDelta;
      this.currentOnSegment = onSegment;

      // 重置当前消息状态
      this.fullText = '';
      this.segments = [];
      this.currentThinking = '';
      this.currentToolCallId = '';
      this.currentToolName = '';

      // 超时
      this.currentTimer = setTimeout(() => {
        if (!this.currentResolve) return;
        const err = this.createTimeoutError(timeoutMs);
        this.logRpcDiagnostic('timeout', err);
        this.restartProcess();
        this.rejectAndReset(err);
      }, timeoutMs);

      // AbortSignal
      if (signal) {
        this.currentSignalAbortHandler = () => {
          if (!this.currentResolve) return;
          this.restartProcess();
          this.rejectAndReset(new DOMException('Aborted', 'AbortError'));
        };
        this.currentSignal = signal;
        signal.addEventListener('abort', this.currentSignalAbortHandler, { once: true });
      }

      // 发送 prompt
      const request = JSON.stringify({
        id: 'pisidian-prompt',
        type: 'prompt',
        message,
      });

      try {
        this.child!.stdin!.write(request + '\n');
      } catch (e) {
        this.rejectAndReset(new Error(`Failed to send message: ${(e as Error).message}`));
      }
    });
  }

  /**
   * 中止当前正在进行的操作。
   * 向 pi 发送 abort 命令，进程保持存活以供后续消息使用。
   */
  abort(): void {
    try {
      this.child?.stdin?.write(JSON.stringify({ type: 'abort' }) + '\n');
    } catch {
      // ignore
    }
  }

  /**
   * 初始化获取会话统计（模型名称等），不发送消息。
   * 进程不存在时自动创建。
   */
  async fetchStats(): Promise<SessionStats> {
    // 如果已经有统计且不在处理中，直接返回缓存
    if (this._stats.modelLabel && !this.currentResolve) {
      return this._stats;
    }

    await this.ensureProcess();

    return new Promise((resolve) => {
      const origResolve = this.currentResolve;
      const origReject = this.currentReject;
      const finish = () => {
        clearTimeout(timer);
        this.pendingStats = false;
        this.statsCollected = 0;
        this.currentResolve = origResolve;
        this.currentReject = origReject;
        resolve(this._stats);
      };
      const timer = setTimeout(finish, 5000);

      // 使用一个特殊的标记让事件解析器知道这是统计查询
      this.pendingStats = true;
      this.statsCollected = 0;
      this.currentResolve = (result) => {
        this._stats = result.stats ?? {};
        finish();
      };
      this.currentReject = () => {
        finish();
      };

      try {
        this.child!.stdin!.write(
          JSON.stringify({ id: 'pisidian-get-state', type: 'get_state' }) + '\n',
        );
        this.child!.stdin!.write(
          JSON.stringify({ id: 'pisidian-get-stats', type: 'get_session_stats' }) + '\n',
        );
      } catch {
        finish();
      }
    });
  }

  /**
   * 开始一个新会话（清空对话上下文但保持进程存活）。
   */
  async newSession(): Promise<void> {
    await this.ensureProcess();
    this._activeSessionFile = null;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingCommandResolve = null;
        resolve();
      }, 5000);
      this.pendingCommandResolve = () => {
        clearTimeout(timer);
        this.pendingCommandResolve = null;
        resolve();
      };
      try {
        this.child!.stdin!.write(
          JSON.stringify({ type: 'new_session' }) + '\n',
        );
      } catch {
        clearTimeout(timer);
        this.pendingCommandResolve = null;
        resolve();
      }
    });
  }

  /**
   * 列出当前 vault 下所有历史会话。
   * 通过读取 pi 的 sessions 目录获取 JSONL 文件列表，按修改时间降序排列。
   */
  listSessions(): SessionInfo[] {
    if (!this._sessionFile) return [];

    const sessionDir = path.dirname(this._sessionFile);
    if (!fs.existsSync(sessionDir)) return [];

    try {
      const entries = fs.readdirSync(sessionDir);
      const sessions: SessionInfo[] = [];

      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue;
        const fullPath = path.join(sessionDir, entry);
        try {
          const stat = fs.statSync(fullPath);
          const id = entry.replace(/\.jsonl$/, '');

          // 尝试从元数据读取会话名称，否则使用首条用户消息作为标题
          let name: string | undefined;
          let title: string | undefined;
          let messageCount: number | undefined;
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n').filter((line) => line.trim());
            messageCount = lines.length;

            for (const line of lines.slice(0, 20)) {
              try {
                const parsed = JSON.parse(line) as Record<string, unknown>;
                name ??= getSessionDisplayName(parsed);
                title ??= getMessagePreview(parsed);
                if (name && title) break;
              } catch {
                // skip malformed lines
              }
            }
          } catch {
            // 解析失败则跳过元数据
          }

          sessions.push({
            path: fullPath,
            id,
            name,
            title: title ? formatSessionListTitle(title) : undefined,
            mtime: stat.mtimeMs,
            messageCount,
          });
        } catch {
          // 无法读取则跳过
        }
      }

      // 按修改时间降序
      sessions.sort((a, b) => b.mtime - a.mtime);
      return sessions;
    } catch {
      return [];
    }
  }

  /** 读取并格式化一个历史 session jsonl 文件，供消息列表渲染 */
  loadSessionMessages(sessionPath: string): Message[] {
    const resolvedSessionPath = this.resolveSessionPath(sessionPath);
    if (!resolvedSessionPath) {
      return [];
    }

    const fallbackTimestamp = fs.statSync(resolvedSessionPath).mtimeMs;
    const messages: Message[] = [];
    let assistantText = '';
    let thinkingText = '';
    let counter = 0;

    const nextId = (role: string) => `session-${path.basename(resolvedSessionPath, '.jsonl')}-${role}-${++counter}`;

    const flushAssistant = () => {
      const content = assistantText.trim();
      if (!content) return;
      messages.push({
        id: nextId('assistant'),
        role: 'assistant',
        content,
        timestamp: fallbackTimestamp,
      });
      assistantText = '';
    };

    const pushDirectMessage = (record: Record<string, unknown>) => {
      const direct = directMessageFromRecord(record, nextId('message'), fallbackTimestamp);
      if (!direct) return false;
      flushAssistant();
      messages.push(direct);
      return true;
    };

    try {
      const lines = fs.readFileSync(resolvedSessionPath, 'utf8')
        .split('\n')
        .filter((line) => line.trim());

      for (const line of lines) {
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (Array.isArray(event.messages)) {
          for (const item of event.messages) {
            if (item && typeof item === 'object') {
              pushDirectMessage(item as Record<string, unknown>);
            }
          }
          continue;
        }

        const directHandled = pushDirectMessage(event);
        if (directHandled) continue;

        if (event.type === 'message_update') {
          const msgEvt = event.assistantMessageEvent as Record<string, unknown> | undefined;
          if (!msgEvt || typeof msgEvt !== 'object') continue;

          const evtType = msgEvt.type as string | undefined;
          if (evtType === 'thinking_start') {
            thinkingText = '';
            continue;
          }
          if (evtType === 'thinking_delta') {
            thinkingText += valueToText(msgEvt.delta);
            continue;
          }
          if (evtType === 'thinking_end') {
            const content = thinkingText.trim();
            if (content) {
              messages.push({
                id: nextId('thinking'),
                role: 'thinking',
                content,
                timestamp: fallbackTimestamp,
              });
            }
            thinkingText = '';
            continue;
          }
          if (evtType === 'text_delta') {
            assistantText += valueToText(msgEvt.delta);
            continue;
          }
        }

        if (event.type === 'tool_execution_end') {
          const content = toolResultText(event.result);
          if (!content) continue;
          messages.push({
            id: nextId('tool'),
            role: 'tool',
            content,
            timestamp: fallbackTimestamp,
            toolCallId: typeof event.toolCallId === 'string' ? event.toolCallId : undefined,
            toolName: typeof event.toolName === 'string' ? event.toolName : undefined,
            status: event.isError ? 'error' : 'success',
          });
          continue;
        }

        if (event.type === 'agent_end') {
          flushAssistant();
        }
      }

      flushAssistant();
      // 历史会话中所有 user 消息默认折叠
      return messages.map((m) => m.role === 'user' ? { ...m, collapsed: true } : m);
    } catch {
      return [];
    }
  }

  /** 删除一个历史 session jsonl 文件 */
  deleteSession(sessionPath: string): boolean {
    const resolvedSessionPath = this.resolveSessionPath(sessionPath);
    if (!resolvedSessionPath) return false;

    try {
      fs.unlinkSync(resolvedSessionPath);
      if (this._activeSessionFile === resolvedSessionPath) {
        this._activeSessionFile = null;
        this.restartProcess();
      }
      return true;
    } catch {
      return false;
    }
  }

  /** 切换到指定历史 session，并返回该 session 的历史消息用于渲染 */
  switchSession(sessionPath: string): Message[] {
    const resolvedSessionPath = this.resolveSessionPath(sessionPath);
    if (!resolvedSessionPath) return [];

    this._activeSessionFile = resolvedSessionPath;
    this._sessionFile = resolvedSessionPath;
    this.restartProcess();
    return this.loadSessionMessages(resolvedSessionPath);
  }

  /** 销毁 pi 子进程，释放资源 */
  dispose(): void {
    this.rejectAndReset(new DOMException('Session disposed', 'AbortError'));
    this.stopProcess();
  }

  // ---- 内部方法 ----

  /** 确保子进程存在且存活 */
  private async ensureProcess(): Promise<void> {
    if (this.child && !this.child.killed) return;
    if (this.ensureProcessPromise) return this.ensureProcessPromise;

    // 清理旧引用
    if (this.child) {
      this.child.removeAllListeners();
      this.child = null;
    }

    const piCmd = findPiCommand();
    const args = ['--mode', 'rpc', '--offline'];
    if (this._activeSessionFile) {
      args.push('--session', this._activeSessionFile);
    }
    this.buffer = '';
    this.stderrTail = '';
    this.lastEventType = '';
    this.lastEventAt = 0;
    this.lastRawLine = '';

    const promise = new Promise<void>((resolve, reject) => {
      const child = spawn(piCmd, args, {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.vaultPath || undefined,
      });

      this.child = child;

      child.stdout!.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString('utf8');
        const lines = this.buffer.split(/\r?\n/);
        this.buffer = lines.pop() ?? '';

        for (const line of lines) {
          this.handleLine(line);
        }
      });

      child.stderr!.on('data', (chunk: Buffer) => {
        this.appendStderr(chunk.toString('utf8'));
      });

      child.on('error', (err) => {
        this.logRpcDiagnostic('process-error', err);
        this.child = null;
        this.rejectAndReset(err);
        reject(err);
      });

      child.on('exit', (code, signal) => {
        if (code !== 0 || signal) {
          this.logRpcDiagnostic('process-exit', new Error(`pi process exited (code=${code}, signal=${signal})`));
        }
        // 处理残留缓冲
        if (this.buffer.trim()) {
          this.handleLine(this.buffer);
          this.buffer = '';
        }

        // 如果有正在等待的消息，用已有内容 resolve
        const hasPending = !!this.currentResolve;
        if (hasPending) {
          if (this.fullText || this.segments.length > 0) {
            this.resolveWithResult();
          } else {
            this.rejectAndReset(
              new Error(`pi process exited (code=${code}, signal=${signal}) before completing`),
            );
          }
        }

        this.child = null;
      });

      // RPC 模式启动即可写入
      resolve();
    });

    this.ensureProcessPromise = promise.finally(() => {
      this.ensureProcessPromise = null;
    });
    return this.ensureProcessPromise;
  }

  /** 停止当前 pi 子进程 */
  private stopProcess(): void {
    if (this.child && !this.child.killed) {
      try {
        this.child.stdin?.end();
      } catch { /* ignore */ }
      try {
        this.child.kill();
      } catch { /* ignore */ }
    }
    if (this.child) {
      this.child.removeAllListeners();
    }
    this.child = null;
    this.buffer = '';
    this.ensureProcessPromise = null;
  }

  /** 当前 RPC 进程状态不可信时，丢弃并等待下一次请求重建 */
  private restartProcess(): void {
    this.pendingStats = false;
    this.statsCollected = 0;
    this.pendingCommandResolve = null;
    this.stopProcess();
  }

  private appendStderr(text: string): void {
    this.stderrTail = (this.stderrTail + text).slice(-4000);
  }

  private createTimeoutError(timeoutMs: number): Error {
    const lastEventAgeMs = this.lastEventAt ? Date.now() - this.lastEventAt : null;
    const details = [
      `RPC timed out after ${timeoutMs}ms`,
      `cwd=${this.vaultPath || '(default)'}`,
      `session=${this.sessionFile ?? '(unknown)'}`,
      `lastEvent=${this.lastEventType || '(none)'}`,
      `lastEventAgeMs=${lastEventAgeMs ?? '(none)'}`,
      `textLength=${this.fullText.length}`,
      `segments=${this.segments.length}`,
    ];

    if (this.stderrTail.trim()) {
      details.push(`stderr=${this.stderrTail.trim().slice(-500)}`);
    }

    return new Error(details.join(' | '));
  }

  private logRpcDiagnostic(reason: string, error?: Error): void {
    console.warn('[pisidian] RPC diagnostic:', {
      reason,
      error: error?.message,
      cwd: this.vaultPath || undefined,
      sessionFile: this.sessionFile,
      childPid: this.child?.pid,
      childKilled: this.child?.killed,
      bufferLength: this.buffer.length,
      lastEventType: this.lastEventType,
      lastEventAgeMs: this.lastEventAt ? Date.now() - this.lastEventAt : null,
      lastRawLine: this.lastRawLine.slice(-1000),
      stderrTail: this.stderrTail.trim().slice(-1000),
      fullTextLength: this.fullText.length,
      segmentCount: this.segments.length,
      pendingStats: this.pendingStats,
      statsCollected: this.statsCollected,
    });
  }

  /** 将外部传入的 session path 限制在当前 pi session 目录内 */
  private resolveSessionPath(sessionPath: string): string | null {
    const baseSessionFile = this._sessionFile ?? this._activeSessionFile;
    if (!baseSessionFile) return null;

    const sessionDir = path.dirname(baseSessionFile);
    const resolvedSessionDir = path.resolve(sessionDir);
    const resolvedSessionPath = path.resolve(sessionPath);

    if (
      path.dirname(resolvedSessionPath) !== resolvedSessionDir ||
      !resolvedSessionPath.endsWith('.jsonl') ||
      !fs.existsSync(resolvedSessionPath)
    ) {
      return null;
    }

    return resolvedSessionPath;
  }

  /** 解析一行 JSON 事件 */
  private handleLine(line: string): void {
    if (!line.trim()) return;
    this.lastRawLine = line;

    let event: PiRpcEvent;
    try {
      event = JSON.parse(line) as PiRpcEvent;
    } catch (error) {
      console.warn('[pisidian] Ignoring non-JSON RPC line:', {
        error: (error as Error).message,
        line: line.slice(-1000),
      });
      return;
    }
    this.lastEventType = event.type;
    this.lastEventAt = Date.now();

    // ============================================
    //  message_update — assistant 消息流式事件
    // ============================================
    if (event.type === 'message_update') {
      const msgEvt = event.assistantMessageEvent as Record<string, unknown> | undefined;
      if (!msgEvt || typeof msgEvt !== 'object') return;

      const evtType = msgEvt.type as string;

      // ---- thinking 块 ----
      if (evtType === 'thinking_start') {
        this.currentThinking = '';
        return;
      }
      if (evtType === 'thinking_delta') {
        const delta = msgEvt.delta as string | undefined;
        if (delta) this.currentThinking += delta;
        return;
      }
      if (evtType === 'thinking_end') {
        if (this.currentThinking) {
          const seg: StreamSegment = { type: 'thinking', text: this.currentThinking };
          this.segments.push(seg);
          this.currentOnSegment?.(seg);
        }
        this.currentThinking = '';
        return;
      }

      // ---- 文本增量（仅文本，不含 thinking）----
      if (evtType === 'text_delta') {
        const delta = msgEvt.delta as string | undefined;
        if (delta) {
          this.fullText += delta;
          this.currentOnDelta?.(delta);
        }
        return;
      }

      // ---- 工具调用 ----
      if (evtType === 'toolcall_start') {
        this.currentToolCallId = (msgEvt.id as string) || '';
        this.currentToolName = (msgEvt.name as string) || '';
        return;
      }
      if (evtType === 'toolcall_end') {
        this.currentToolCallId = '';
        this.currentToolName = '';
        return;
      }

      return;
    }

    // ============================================
    //  tool_execution — 工具执行事件
    // ============================================
    if (event.type === 'tool_execution_start') {
      this.currentToolCallId = (event.toolCallId as string) || '';
      this.currentToolName = (event.toolName as string) || '';
      return;
    }

    if (event.type === 'tool_execution_end') {
      const result = event.result as Record<string, unknown> | undefined;
      const contentArr = result?.content as Array<Record<string, unknown>> | undefined;
      const outputText = contentArr?.[0]?.text as string | undefined ?? '';

      const seg: StreamSegment = {
        type: 'tool_result',
        text: outputText,
        toolName: (event.toolName as string) || this.currentToolName,
        toolCallId: (event.toolCallId as string) || this.currentToolCallId,
        status: event.isError ? 'error' : 'success',
        isError: !!event.isError,
      };
      this.segments.push(seg);
      this.currentOnSegment?.(seg);
      this.currentToolCallId = '';
      this.currentToolName = '';
      return;
    }

    // ============================================
    //  agent_end — agent 完成
    // ============================================
    if (event.type === 'agent_end') {
      this.pendingStats = true;
      this.statsCollected = 0;
      try {
        this.child!.stdin!.write(
          JSON.stringify({ id: 'pisidian-get-state', type: 'get_state' }) + '\n',
        );
        this.child!.stdin!.write(
          JSON.stringify({ id: 'pisidian-get-stats', type: 'get_session_stats' }) + '\n',
        );
      } catch {
        this.resolveWithResult();
      }
      return;
    }

    // ============================================
    //  response — 命令响应
    // ============================================
    const eventId = (event as Record<string, unknown>).id as string | undefined;
    const eventCmd = (event as Record<string, unknown>).command as string | undefined;

    // 处理 new_session 等通用命令响应
    if (
      this.pendingCommandResolve &&
      event.type === 'response' &&
      eventCmd === 'new_session' &&
      event.success === true
    ) {
      const cb = this.pendingCommandResolve;
      this.pendingCommandResolve = null;
      cb();
    }

    // 处理 get_state 响应
    if (this.pendingStats && eventId === 'pisidian-get-state' && event.success === true) {
      const data = event.data as Record<string, unknown> | undefined;
      if (data) {
        const model = data.model as Record<string, unknown> | undefined;
        this._stats.modelLabel = (model?.name as string) || (model?.id as string) || undefined;
        const sf = data.sessionFile as string | undefined;
        if (sf) this._sessionFile = sf;
      }
      this.statsCollected++;
      if (this.statsCollected >= 2) {
        this.resolveWithResult();
      }
      return;
    }

    // 处理 get_session_stats 响应
    if (this.pendingStats && eventId === 'pisidian-get-stats' && event.success === true) {
      const data = event.data as Record<string, unknown> | undefined;
      if (data) {
        const tokens = data.tokens as Record<string, unknown> | undefined;
        this._stats.inputTokens = (tokens?.input as number) ?? undefined;
        this._stats.outputTokens = (tokens?.output as number) ?? undefined;
        this._stats.cost = (data.cost as number) ?? undefined;
        const ctxUsage = data.contextUsage as Record<string, unknown> | undefined;
        this._stats.contextPercent = (ctxUsage?.percent as number) ?? undefined;
        this._stats.contextWindow = (ctxUsage?.contextWindow as number) ?? undefined;
      }
      this.statsCollected++;
      if (this.statsCollected >= 2) {
        this.resolveWithResult();
      }
      return;
    }

    // prompt 被拒绝
    if (eventCmd === 'prompt' && event.success === false) {
      const errMsg = (event as Record<string, unknown>).error ?? 'Unknown error';
      this.rejectAndReset(new Error(`RPC prompt rejected: ${errMsg}`));
    }
  }

  /** 用当前累积的结果 resolve promise */
  private resolveWithResult(): void {
    if (!this.currentResolve) return;

    this.pendingStats = false;
    this.statsCollected = 0;

    const result: SendMessageResult = {
      text: this.fullText,
      segments: this.segments,
      stats: { ...this._stats },
    };

    this.cleanupPromise();
    this.currentResolve(result);
    this.currentResolve = null;
    this.currentReject = null;
  }

  /** 用错误拒绝当前 promise 并重置状态 */
  private rejectAndReset(error: Error): void {
    if (!this.currentReject) return;

    this.cleanupPromise();
    this.currentReject(error);
    this.currentResolve = null;
    this.currentReject = null;
  }

  /** 清理当前 promise 相关的定时器和监听器 */
  private cleanupPromise(): void {
    if (this.currentTimer) {
      clearTimeout(this.currentTimer);
      this.currentTimer = null;
    }
    if (this.currentSignal && this.currentSignalAbortHandler) {
      this.currentSignal.removeEventListener('abort', this.currentSignalAbortHandler);
      this.currentSignalAbortHandler = null;
    }
    this.currentSignal = null;
    this.currentOnDelta = undefined;
    this.currentOnSegment = undefined;
  }
}
