/**
 * 编辑器内联 AI 生成 — 浮动 popup 方案
 *
 * 流程：
 *   textarea 输入 → Ctrl+Enter → 隐藏 textarea → 启动 no-session RPC 子进程
 *   → 流式输出到预览区 → agent_end → 显示 [取消] [替换选区] [插入]
 */

import { App, Editor } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { Compartment } from '@codemirror/state';
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
      // 返回空行上一行的末尾
      return { line: l - 2, ch: doc.line(l - 1).length };
    }
  }
  // 没找到空行，返回文档末尾
  return { line: total - 1, ch: doc.line(total).length };
}

// ---- InlineAIPopup ----

export class InlineAIPopup {
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

  // Cleanup fns
  private onScroll: (() => void) | null = null;
  private onKeydown: (() => void) | null = null;
  private onEditorInput: (() => void) | null = null;
  private onClickOutside: (() => void) | null = null;
  private cursorCompartment: Compartment | null = null;

  // State
  private child: ChildProcess | null = null;
  private rpcTimer: ReturnType<typeof setTimeout> | null = null;
  private savedCursor: { line: number; ch: number } | null = null;
  private selectionFrom: { line: number; ch: number } | null = null;
  private selectionTo: { line: number; ch: number } | null = null;
  private selectedText = '';
  private generatedText = '';

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

    const cursor = this.editor.getCursor();
    const pos = this.cm.state.doc.line(cursor.line + 1).from + cursor.ch;
    const coords = this.cm.coordsAtPos(pos);
    if (!coords) return;

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

    // preview
    const previewEl = document.createElement('div');
    previewEl.className = 'pisidian-inline-popup__preview';

    // actions
    const actionsEl = document.createElement('div');
    actionsEl.className = 'pisidian-inline-popup__actions';

    // cancel
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'pisidian-inline-popup__action-btn';
    cancelBtn.innerHTML =
      '<svg class="pisidian-inline-popup__action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg><span>取消</span>';
    cancelBtn.onclick = () => this.hide();

    actionsEl.appendChild(cancelBtn);

    // replace selection (only if there was a selection)
    let replaceBtn: HTMLButtonElement | null = null;
    if (this.selectedText) {
      replaceBtn = document.createElement('button');
      replaceBtn.className = 'pisidian-inline-popup__action-btn';
      replaceBtn.innerHTML =
        '<svg class="pisidian-inline-popup__action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg><span>替换选区</span>';
      replaceBtn.onclick = () => this.doReplace();
      actionsEl.appendChild(replaceBtn);
    }

    // insert
    const insertBtn = document.createElement('button');
    insertBtn.className = 'pisidian-inline-popup__action-btn';
    insertBtn.innerHTML =
      '<svg class="pisidian-inline-popup__action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg><span>插入</span>';
    insertBtn.onclick = () => this.doInsert();
    actionsEl.appendChild(insertBtn);

    // assemble
    if (selectionInfoEl) el.appendChild(selectionInfoEl);
    el.appendChild(textarea);
    el.appendChild(previewEl);
    el.appendChild(actionsEl);

    // ---- position ----
    const lineEl = this.cm.contentDOM.querySelector('.cm-line');
    const lineRect = lineEl?.getBoundingClientRect();
    const contentRect = this.cm.contentDOM.getBoundingClientRect();
    const popupWidth = lineRect?.width ?? contentRect.width;
    const left = lineRect?.left ?? contentRect.left;

    // 选区顶端坐标 vs 光标下方坐标
    const anchorTop = this.getAnchorTop();

    // 先挂到 DOM（不可见）以测量高度
    el.style.visibility = 'hidden';
    el.style.position = 'fixed';
    el.style.left = `${left}px`;
    el.style.width = `${popupWidth}px`;
    el.style.top = '0px';
    document.body.appendChild(el);

    const elHeight = el.getBoundingClientRect().height;
    const spaceAbove = anchorTop;
    const preferAbove = this.selectedText ? true : false;

    // 优先放上方（有选区时），空间不够则放下方
    if (preferAbove && spaceAbove > elHeight + 20) {
      el.style.top = `${Math.max(4, anchorTop - elHeight - 4)}px`;
    } else {
      el.style.top = `${anchorTop + 4}px`;
    }
    el.style.visibility = '';

    this.el = el;
    this.textarea = textarea;
    this.selectionInfoEl = selectionInfoEl;
    this.previewEl = previewEl;
    this.actionsEl = actionsEl;
    this.insertBtn = insertBtn;
    this.replaceBtn = replaceBtn;

    // ---- events ----
    textarea.onkeydown = (e: KeyboardEvent) => {
      if (e.isComposing) return; // IME 组合中不触发
      if (e.key === 'Escape' || e.code === 'Escape') {
        e.preventDefault();
        this.hide();
        return;
      }
      // Enter（无修饰键）提交；Ctrl+Enter 留给浏览器默认换行
      if (e.code === 'Enter' && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.submit();
      }
    };

    // Ctrl+Enter 在 textarea 中默认就是换行，无需处理

    // scroll → reposition
    const onScroll = () => this.reposition();
    this.cm.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    this.onScroll = () => this.cm.scrollDOM.removeEventListener('scroll', onScroll);

    // typing in editor → close
    const onEditorInput = () => this.hide();
    this.cm.contentDOM.addEventListener('input', onEditorInput, { once: true });
    this.onEditorInput = () => this.cm.contentDOM.removeEventListener('input', onEditorInput);

    // cursor line change → close
    const compartment = new Compartment();
    this.cursorCompartment = compartment;
    this.cm.dispatch({
      effects: compartment.reconfigure(
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) {
            const head = update.state.selection.main.head;
            const newLine = update.state.doc.lineAt(head).number - 1;
            if (newLine !== cursor.line) this.hide();
          }
        }),
      ),
    });

    // global Escape
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.key === 'Escape' || e.code === 'Escape') && this.el) {
        e.preventDefault();
        if (this.isGenerating) {
          if (this.escPending) {
            this.clearEscPending();
            this.hide();
          } else {
            this.escPending = true;
            if (this.previewEl) {
              this.previewEl.textContent = '再按 Esc 取消生成\n\n' + (this.generatedText || '思考中…');
            }
            this.escTimer = setTimeout(() => {
              this.escPending = false;
              if (this.previewEl && this.isGenerating) {
                this.previewEl.textContent = this.generatedText || '思考中…';
              }
            }, 2000);
          }
        } else {
          this.hide();
        }
      }
    };
    document.addEventListener('keydown', onKeydown);
    this.onKeydown = () => document.removeEventListener('keydown', onKeydown);

    // Enter on actions bar → default to insert
    actionsEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.doInsert();
      }
    });

    // click outside popup → close (生成中不关，防误触)
    const onClick = (e: MouseEvent) => {
      if (this.el && !this.el.contains(e.target as Node) && !this.isGenerating) {
        this.hide();
      }
    };
    document.addEventListener('click', onClick, true);

    // 切换 tab / 文件 → 关闭
    const onLeafChange = () => this.hide();
    this.app.workspace.on('active-leaf-change', onLeafChange);
    this.onClickOutside = () => {
      document.removeEventListener('click', onClick, true);
      this.app.workspace.off('active-leaf-change', onLeafChange);
    };

    setTimeout(() => textarea.focus(), 0);
  }

  hide() {
    this.isGenerating = false;
    this.clearEscPending();
    this.cleanupRpc();
    this.onScroll?.(); this.onScroll = null;
    this.onEditorInput?.(); this.onEditorInput = null;
    this.onKeydown?.(); this.onKeydown = null;
    this.onClickOutside?.(); this.onClickOutside = null;
    if (this.cursorCompartment) {
      this.cm.dispatch({ effects: this.cursorCompartment.reconfigure([]) });
      this.cursorCompartment = null;
    }
    if (this.el) { this.el.remove(); this.el = null; }
    this.textarea = null;
    this.selectionInfoEl = null;
    this.previewEl = null;
    this.actionsEl = null;
  }

  // ================================================================
  //  SUBMIT → RPC
  // ================================================================

  private submit() {
    const userInput = this.textarea?.value.trim();
    if (!userInput || !this.el) return;

    // save cursor position
    this.savedCursor = this.editor.getCursor();

    // hide selection-info and textarea during generation
    if (this.selectionInfoEl) this.selectionInfoEl.style.display = 'none';
    this.textarea!.style.display = 'none';
    this.previewEl!.textContent = '思考中…';
    this.previewEl!.style.display = 'block';
    this.actionsEl!.style.display = 'none';
    this.generatedText = '';

    // build prompt: include selected text as context if present
    let message = userInput;
    if (this.selectedText) {
      message = `用户选中了以下文本作为参考上下文：\n\n---\n${this.selectedText}\n---\n\n请根据以上上下文，执行以下指令：${userInput}`;
    }

    // spawn no-session RPC process
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

    child.stderr!.on('data', (_chunk: Buffer) => {
      // accumulate but don't display unless error
    });

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

    // timeout
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
        if (this.generatedText === '' && this.previewEl) {
          this.previewEl.textContent = '';
        }
        const d = delta.delta as string;
        if (d) {
          this.generatedText += d;
          if (this.previewEl) this.previewEl.textContent = this.generatedText;
        }
      }
      return;
    }

    if (event.type === 'agent_end') {
      this.finishGeneration();
      return;
    }

    if (event.type === 'response' && event.success === false) {
      this.showError(`RPC 错误: ${event.error ?? '未知错误'}`);
    }
  }

  private finishGeneration() {
    this.clearRpcTimer();
    this.cleanupRpc();
    if (!this.generatedText) { this.showError('AI 未生成任何内容'); return; }
    if (this.actionsEl) {
      this.actionsEl.style.display = 'flex';
      this.insertBtn?.focus();
    }
  }

  private showError(msg: string) {
    this.isGenerating = false;
    this.clearEscPending();
    this.clearRpcTimer();
    this.cleanupRpc();
    if (this.previewEl) { this.previewEl.textContent = `❌ ${msg}`; this.previewEl.style.display = 'block'; }
    if (this.actionsEl) this.actionsEl.style.display = 'none';
  }

  // ================================================================
  //  INSERT / REPLACE
  // ================================================================

  /** 检查选区是否仍然有效（文本未变） */
  private isSelectionValid(): boolean {
    if (!this.selectedText || !this.selectionFrom || !this.selectionTo) return false;
    const current = this.editor.getRange(this.selectionFrom, this.selectionTo);
    return current === this.selectedText || current.trim() === this.selectedText;
  }

  private doReplace() {
    if (!this.generatedText) return;
    if (this.isSelectionValid()) {
      this.editor.replaceRange(this.generatedText, this.selectionFrom!, this.selectionTo!);
    } else {
      // 选区丢失 → 插入到光标处
      this.editor.replaceRange(this.generatedText, this.editor.getCursor());
    }
    this.hide();
  }

  private doInsert() {
    if (!this.generatedText) return;
    if (this.isSelectionValid()) {
      // 插入到选区所在段落末尾，另起一行 + 空一行
      const paraEnd = findParagraphEnd(this.cm, this.selectionTo!.line);
      const text = '\n\n' + this.generatedText;
      this.editor.replaceRange(text, paraEnd);
    } else {
      // 无选区或选区丢失 → 插入到光标处
      const cursor = this.savedCursor ?? this.editor.getCursor();
      this.editor.replaceRange(this.generatedText, cursor);
    }
    this.hide();
  }

  // ================================================================
  //  RPC LIFECYCLE
  // ================================================================

  private cleanupRpc() {
    this.clearRpcTimer();
    if (this.child) {
      // 发送 abort，让 pi 停止生成
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

  private clearEscPending() {
    if (this.escTimer) { clearTimeout(this.escTimer); this.escTimer = null; }
    this.escPending = false;
  }

  // ================================================================
  //  REPOSITION
  // ================================================================

  private getAnchorTop(): number {
    if (this.selectedText && this.selectionFrom) {
      const fromPos = this.cm.state.doc.line(this.selectionFrom.line + 1).from + this.selectionFrom.ch;
      const fromCoords = this.cm.coordsAtPos(fromPos);
      if (fromCoords) return fromCoords.top;
    }
    const cursor = this.editor.getCursor();
    const pos = this.cm.state.doc.line(cursor.line + 1).from + cursor.ch;
    return this.cm.coordsAtPos(pos)?.bottom ?? 0;
  }

  private reposition() {
    if (!this.el) return;

    const anchorTop = this.getAnchorTop();
    if (!anchorTop) { this.hide(); return; }

    const lineEl = this.cm.contentDOM.querySelector('.cm-line');
    const lineRect = lineEl?.getBoundingClientRect();
    const contentRect = this.cm.contentDOM.getBoundingClientRect();

    const elHeight = this.el.getBoundingClientRect().height;
    const spaceAbove = anchorTop;
    const preferAbove = this.selectedText ? true : false;

    if (preferAbove && spaceAbove > elHeight + 20) {
      this.el.style.top = `${Math.max(4, anchorTop - elHeight - 4)}px`;
    } else {
      this.el.style.top = `${anchorTop + 4}px`;
    }
    this.el.style.left = `${lineRect?.left ?? contentRect.left}px`;
    this.el.style.width = `${lineRect?.width ?? contentRect.width}px`;
  }
}
