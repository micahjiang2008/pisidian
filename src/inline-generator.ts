/**
 * 编辑器内联 AI 生成 — 浮动 popup 方案
 *
 * 流程：
 *   Ctrl+Shift+G 呼出 → 输入 → Enter 提交 → 流式输出 → 按钮操作
 *
 * 关闭规则：
 *   输入态：Esc / 点击外部
 *   生成中：不能关闭（仅停止按钮可中止）
 *   生成后：Esc / 点击外部
 */

import { App, Editor } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { spawn, type ChildProcess } from 'child_process';

// ---- helpers ----

function findPiCommand(): string {
  const appData = process.env.APPDATA;
  const candidates = [
    'pi',
    appData ? `${appData}\\npm\\pi.cmd` : undefined,
    process.env.USERPROFILE ? `${process.env.USERPROFILE}\\AppData\\Roaming\\npm\\pi.cmd` : undefined,
  ].filter((cmd): cmd is string => Boolean(cmd));
  return candidates[0] ?? 'pi';
}

/** 找选区所属段落的末尾（下一个空行之前） */
function findParagraphEnd(view: EditorView, fromLine: number): { line: number; ch: number } {
  const doc = view.state.doc;
  const total = doc.lines;
  for (let l = fromLine + 1; l <= total; l++) {
    if (doc.line(l).text.trim() === '') {
      return { line: l - 2, ch: doc.line(l - 1).length };
    }
  }
  return { line: total - 1, ch: doc.line(total).length };
}

// ---- InlineGenerator ----

export class InlineGenerator {
  private app: App;
  private editor: Editor;
  private cm: EditorView;

  // DOM
  private el: HTMLDivElement | null = null;
  private textarea: HTMLTextAreaElement | null = null;
  private selectionInfoEl: HTMLDivElement | null = null;
  private previewEl: HTMLDivElement | null = null;
  private actionsEl: HTMLDivElement | null = null;
  private insertBtn: HTMLButtonElement | null = null;
  private replaceBtn: HTMLButtonElement | null = null;
  private sendIcon: HTMLElement | null = null;

  // Cleanup fns
  private onScroll: (() => void) | null = null;
  private onKeydown: (() => void) | null = null;
  private onClickOutside: (() => void) | null = null;

  // State
  private child: ChildProcess | null = null;
  private rpcTimer: ReturnType<typeof setTimeout> | null = null;
  /** 呼出时的光标位置（插入目标） */
  private targetCursor: { line: number; ch: number } | null = null;
  private selectionFrom: { line: number; ch: number } | null = null;
  private selectionTo: { line: number; ch: number } | null = null;
  private selectedText = '';
  private generatedText = '';
  private isGenerating = false;

  constructor(app: App, editor: Editor) {
    this.app = app;
    this.editor = editor;
    this.cm = editor.cm as EditorView;
  }

  // ================================================================
  //  PUBLIC API
  // ================================================================

  show() {
    if (this.el) return;

    // 保存呼出时的光标位置
    this.targetCursor = this.editor.getCursor();

    // ---- capture selection ----
    const rawSelection = this.editor.getSelection().trim();
    this.selectedText = rawSelection;
    if (this.selectedText) {
      this.selectionFrom = this.editor.getCursor('from');
      this.selectionTo = this.editor.getCursor('to');
    }

    // ---- build DOM ----
    const el = document.createElement('div');
    el.className = 'pisidian-inline-popup';

    // selection info (if any)
    let selectionInfoEl: HTMLDivElement | null = null;
    if (this.selectedText) {
      selectionInfoEl = document.createElement('div');
      selectionInfoEl.className = 'pisidian-inline-popup__selection-info';
      const cleaned = this.selectedText.replace(/\s+/g, ' ').trim();
      const preview = cleaned.length > 20 ? cleaned.slice(0, 20) + '…' : cleaned;
      selectionInfoEl.textContent = preview;
    }

    // textarea
    const textarea = document.createElement('textarea');
    textarea.className = 'pisidian-inline-popup__textarea';
    textarea.placeholder = '描述你想让 AI 生成的内容…';
    textarea.rows = 1;
    const autoHeight = () => {
      textarea.style.height = 'auto';
      const style = getComputedStyle(textarea);
      const lh = parseFloat(style.lineHeight) || 22;
      const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) || 0;
      textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, lh + pad), lh * 3 + pad)}px`;
    };
    textarea.addEventListener('input', autoHeight);

    // send / stop icon
    const sendIcon = document.createElement('span');
    sendIcon.className = 'clickable-icon pisidian-inline-popup__send-icon';
    sendIcon.setAttribute('aria-label', '发送');
    sendIcon.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
    sendIcon.onclick = () => {
      if (this.isGenerating) {
        this.hide();
      } else {
        this.submit();
      }
    };

    // input row
    const inputRow = document.createElement('div');
    inputRow.className = 'pisidian-inline-popup__input-row';

    // star AI icon
    const starIcon = document.createElement('span');
    starIcon.className = 'pisidian-inline-popup__star-icon';
    starIcon.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>';
    inputRow.appendChild(starIcon);
    inputRow.appendChild(textarea);
    inputRow.appendChild(sendIcon);

    // preview
    const previewEl = document.createElement('div');
    previewEl.className = 'pisidian-inline-popup__preview';

    // actions
    const actionsEl = document.createElement('div');
    actionsEl.className = 'pisidian-inline-popup__actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'pisidian-inline-popup__action-btn';
    cancelBtn.innerHTML =
      '<svg class="pisidian-inline-popup__action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg><span>取消</span>';
    cancelBtn.onclick = () => this.hide();
    actionsEl.appendChild(cancelBtn);

    let replaceBtn: HTMLButtonElement | null = null;
    if (this.selectedText) {
      replaceBtn = document.createElement('button');
      replaceBtn.className = 'pisidian-inline-popup__action-btn';
      replaceBtn.innerHTML =
        '<svg class="pisidian-inline-popup__action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg><span>替换选区</span>';
      replaceBtn.onclick = () => this.doReplace();
      actionsEl.appendChild(replaceBtn);
    }

    const insertBtn = document.createElement('button');
    insertBtn.className = 'pisidian-inline-popup__action-btn';
    insertBtn.innerHTML =
      '<svg class="pisidian-inline-popup__action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg><span>插入</span>';
    insertBtn.onclick = () => this.doInsert();
    actionsEl.appendChild(insertBtn);

    // assemble
    if (selectionInfoEl) el.appendChild(selectionInfoEl);
    el.appendChild(inputRow);
    el.appendChild(previewEl);
    el.appendChild(actionsEl);

    // ---- position ----
    const lineEl = this.cm.contentDOM.querySelector('.cm-line');
    const lineRect = lineEl?.getBoundingClientRect();
    const contentRect = this.cm.contentDOM.getBoundingClientRect();
    const popupWidth = lineRect?.width ?? contentRect.width;
    const left = lineRect?.left ?? contentRect.left;

    el.style.position = 'fixed';
    el.style.left = `${left}px`;
    el.style.width = `${popupWidth}px`;
    el.style.top = '50%';
    el.style.transform = 'translateY(-50%)';

    document.body.appendChild(el);

    this.el = el;
    this.textarea = textarea;
    this.selectionInfoEl = selectionInfoEl;
    this.previewEl = previewEl;
    this.actionsEl = actionsEl;
    this.insertBtn = insertBtn;
    this.replaceBtn = replaceBtn;
    this.sendIcon = sendIcon;

    // ---- events ----

    // textarea: Enter 提交, Ctrl+Enter 换行
    textarea.onkeydown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'Escape' || e.code === 'Escape') {
        e.preventDefault();
        this.hide();
        return;
      }
      // Enter 无修饰键 → 提交
      if (e.code === 'Enter' && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.submit();
      }
    };

    // 阻断 Tab
    textarea.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        // 插入制表符代替跳转焦点
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '\t' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 1;
      }
    });

    // scroll → reposition
    const onScroll = () => this.reposition();
    this.cm.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    this.onScroll = () => this.cm.scrollDOM.removeEventListener('scroll', onScroll);

    // Esc → 关闭（生成中忽略）
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.key === 'Escape' || e.code === 'Escape') && this.el && !this.isGenerating) {
        e.preventDefault();
        this.hide();
      }
      // Enter → 插入（actions 可见时）
      if (e.code === 'Enter' && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey
        && this.el && this.actionsEl && this.actionsEl.style.display !== 'none') {
        e.preventDefault();
        this.doInsert();
      }
    };
    document.addEventListener('keydown', onKeydown);
    this.onKeydown = () => document.removeEventListener('keydown', onKeydown);

    // 点击外部 → 关闭（生成中忽略）
    const onClick = (e: MouseEvent) => {
      if (this.el && !this.el.contains(e.target as Node) && !this.isGenerating) {
        this.hide();
      }
    };
    document.addEventListener('click', onClick, true);
    this.onClickOutside = () => document.removeEventListener('click', onClick, true);

    // Enter on actions bar → insert
    actionsEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.doInsert();
      }
    });

    setTimeout(() => textarea.focus(), 0);
  }

  hide() {
    this.isGenerating = false;
    this.cleanupRpc();
    this.onScroll?.(); this.onScroll = null;
    this.onKeydown?.(); this.onKeydown = null;
    this.onClickOutside?.(); this.onClickOutside = null;
    if (this.el) { this.el.remove(); this.el = null; }
    this.textarea = null;
    this.selectionInfoEl = null;
    this.previewEl = null;
    this.actionsEl = null;
    this.sendIcon = null;
  }

  // ================================================================
  //  SUBMIT → RPC
  // ================================================================

  private submit() {
    const userInput = this.textarea?.value.trim();
    if (!userInput || !this.el) return;

    this.isGenerating = true;
    if (this.selectionInfoEl) this.selectionInfoEl.style.display = 'none';

    // textarea → readonly
    this.textarea!.value = '生成中…';
    this.textarea!.readOnly = true;
    this.textarea!.classList.add('pisidian-inline-popup__textarea--readonly');

    // 图标变停止，移到右上角
    if (this.sendIcon && this.el) {
      this.sendIcon.style.position = 'absolute';
      this.sendIcon.style.top = '8px';
      this.sendIcon.style.right = '8px';
      this.sendIcon.style.zIndex = '1';
      this.sendIcon.setAttribute('aria-label', '停止生成');
      this.sendIcon.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
      this.sendIcon.classList.add('pisidian-inline-popup__send-icon--stop');
      this.el.appendChild(this.sendIcon);
    }

    this.previewEl!.textContent = '';
    this.previewEl!.style.display = 'none';
    this.previewEl!.classList.remove('pisidian-inline-popup__preview--show');
    this.actionsEl!.style.display = 'none';
    this.generatedText = '';

    let message = userInput;
    if (this.selectedText) {
      message = `用户选中了以下文本作为参考上下文：\n\n---\n${this.selectedText}\n---\n\n请根据以上上下文，执行以下指令：${userInput}`;
    }
    message += '\n\n直接输出生成结果。格式紧凑，不使用不必要的标题、列表、引用和其他复杂格式。不要反问用户、不要请求用户做选择、不要等待用户确认。';

    const vaultPath = (this.app.vault.adapter as any).basePath as string;
    const piCmd = findPiCommand();
    const args = ['--mode', 'rpc', '--no-session', '--offline'];
    let buffer = '';

    const child = spawn(piCmd, args, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: vaultPath,
    });
    this.child = child;

    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: any;
        try { event = JSON.parse(line); } catch { continue; }
        this.handleRpcEvent(event);
      }
    });

    child.stderr!.on('data', (_chunk: Buffer) => {});

    child.on('error', (err) => {
      this.showError(`无法启动 pi 进程: ${err.message}`);
    });

    child.on('exit', (code, signal) => {
      if ((code !== 0 || signal) && this.generatedText === '') {
        const reason = signal ? `被信号 ${signal} 终止` : `退出码 ${code}`;
        this.showError(`pi 进程异常退出 (${reason})`);
      }
    });

    child.stdin!.write(
      JSON.stringify({ id: 'inline-prompt', type: 'prompt', message }) + '\n',
    );

    this.rpcTimer = setTimeout(() => {
      if (this.generatedText) {
        this.finishGeneration();
      } else {
        this.showError('请求超时，请重试');
      }
    }, 120_000);
  }

  private handleRpcEvent(event: any) {
    if (event.type === 'message_update') {
      const delta = event.assistantMessageEvent;
      if (!delta) return;
      if (delta.type === 'text_delta') {
        const d = delta.delta as string;
        if (d) this.generatedText += d;
      }
      return;
    }
    if (event.type === 'agent_end') {
      // 从 agent_end 提取完整文本（fallback 到累积的流式文本）
      if (!this.generatedText && event.messages) {
        for (const msg of event.messages) {
          if (msg.role === 'assistant' && msg.content) {
            for (const block of msg.content) {
              if (block.type === 'text') this.generatedText += block.text;
            }
          }
        }
      }
      if (this.previewEl) {
        this.previewEl.textContent = this.generatedText || '';
        this.previewEl.style.display = 'block';
        requestAnimationFrame(() => {
          this.previewEl?.classList.add('pisidian-inline-popup__preview--show');
        });
      }
      this.finishGeneration();
      return;
    }
    if (event.type === 'response' && event.success === false) {
      this.showError(`RPC 错误: ${event.error ?? '未知错误'}`);
    }
  }

  private finishGeneration() {
    this.isGenerating = false;
    this.resetSendIcon();
    this.clearRpcTimer();
    this.cleanupRpc();
    if (!this.generatedText) { this.showError('AI 未生成任何内容'); return; }
    if (this.actionsEl) {
      this.actionsEl.style.display = 'flex';
      const inputRow = this.el?.querySelector('.pisidian-inline-popup__input-row');
      if (inputRow) (inputRow as HTMLElement).style.display = 'none';
      this.reposition();
      this.insertBtn?.focus();
    }
  }

  private showError(msg: string) {
    this.isGenerating = false;
    this.resetSendIcon();
    this.clearRpcTimer();
    this.cleanupRpc();
    if (this.previewEl) {
      this.previewEl.textContent = msg;
      this.previewEl.style.display = 'block';
      requestAnimationFrame(() => {
        this.previewEl?.classList.add('pisidian-inline-popup__preview--show');
      });
    }
    if (this.actionsEl) this.actionsEl.style.display = 'none';
  }

  // ================================================================
  //  INSERT / REPLACE
  // ================================================================

  private isSelectionValid(): boolean {
    if (!this.selectedText || !this.selectionFrom || !this.selectionTo) return false;
    const current = this.editor.getRange(this.selectionFrom, this.selectionTo);
    return current === this.selectedText || current.trim() === this.selectedText;
  }

  private doReplace() {
    if (!this.generatedText) return;
    let pos: { line: number; ch: number };
    if (this.isSelectionValid()) {
      this.editor.replaceRange(this.generatedText, this.selectionFrom!, this.selectionTo!);
      pos = this.selectionFrom!;
    } else {
      const cursor = this.targetCursor ?? this.editor.getCursor();
      this.editor.replaceRange(this.generatedText, cursor);
      pos = cursor;
    }
    this.selectInserted(pos);
    this.hide();
  }

  private doInsert() {
    if (!this.generatedText) return;
    let pos: { line: number; ch: number };
    if (this.isSelectionValid()) {
      const paraEnd = findParagraphEnd(this.cm, this.selectionTo!.line);
      this.editor.replaceRange('\n\n' + this.generatedText, paraEnd);
      pos = { line: paraEnd.line, ch: paraEnd.ch + 2 };
    } else {
      const cursor = this.targetCursor ?? this.editor.getCursor();
      this.editor.replaceRange(this.generatedText, cursor);
      pos = cursor;
    }
    this.selectInserted(pos);
    this.hide();
  }

  private selectInserted(pos: { line: number; ch: number }) {
    const offset = this.cm.state.doc.line(pos.line + 1).from + pos.ch;
    const endOffset = offset + this.generatedText.length;
    const endLine = this.cm.state.doc.lineAt(endOffset);
    this.cm.focus();
    this.cm.dispatch({
      selection: { anchor: offset, head: endOffset },
    });
  }

  // ================================================================
  //  RPC LIFECYCLE
  // ================================================================

  private cleanupRpc() {
    this.clearRpcTimer();
    if (this.child) {
      try { this.child.stdin?.write(JSON.stringify({ type: 'abort' }) + '\n'); } catch { /* ignore */ }
      try { this.child.stdin?.end(); } catch { /* ignore */ }
      try { this.child.kill(); } catch { /* ignore */ }
      this.child.removeAllListeners();
      this.child = null;
    }
  }

  private clearRpcTimer() {
    if (this.rpcTimer) { clearTimeout(this.rpcTimer); this.rpcTimer = null; }
  }

  private resetSendIcon() {
    if (!this.sendIcon) return;
    this.sendIcon.setAttribute('aria-label', '发送');
    this.sendIcon.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
    this.sendIcon.classList.remove('pisidian-inline-popup__send-icon--stop');
    this.sendIcon.style.position = '';
    this.sendIcon.style.top = '';
    this.sendIcon.style.right = '';
    this.sendIcon.style.zIndex = '';
    // 恢复 textarea
    if (this.textarea) {
      this.textarea.value = '';
      this.textarea.readOnly = false;
      this.textarea.classList.remove('pisidian-inline-popup__textarea--readonly');
    }
    // 移回 inputRow 并显示
    const inputRow = this.el?.querySelector('.pisidian-inline-popup__input-row');
    if (inputRow && this.sendIcon) {
      inputRow.appendChild(this.sendIcon);
      (inputRow as HTMLElement).style.display = '';
    }
  }

  // ================================================================
  //  REPOSITION
  // ================================================================

  private reposition() {
    if (!this.el) return;
    const lineEl = this.cm.contentDOM.querySelector('.cm-line');
    const lineRect = lineEl?.getBoundingClientRect();
    const contentRect = this.cm.contentDOM.getBoundingClientRect();
    this.el.style.left = `${lineRect?.left ?? contentRect.left}px`;
    this.el.style.width = `${lineRect?.width ?? contentRect.width}px`;
  }
}
