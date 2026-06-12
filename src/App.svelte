<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { setIcon } from 'obsidian';
  import MessageList from './components/MessageList.svelte';
  import MessageEditor from './components/MessageEditor.svelte';
  import StreamingMessage from './components/StreamingMessage.svelte';
  import { splitStreamingMessage } from './utils/message-utils';
  import { listModels } from './model-catalog';
  import type { App as ObsidianApp } from 'obsidian';
  import type { PisidianSettings } from './settings';
  import { PiSession } from './rpc';
  import { createWorkDirMessage, getInitialWorkDir } from './utils/workdir-utils';
  import type { SessionStats, SessionInfo } from './rpc';
  import type { Attachment, Message, ModelProviderOption, SelectOption, ThinkingLevelMap } from './types';

  interface SelectedContext {
    text: string;
    source: string;
  }

  interface Props {
    vaultPath?: string;
    app?: ObsidianApp;
    settings?: PisidianSettings;
  }

  let { vaultPath, app, settings }: Props = $props();

  let models = $state<ModelProviderOption[]>([]);
  let modelsLoading = $state(true);
  let piAvailable = $state(true);
  let thinkingLevelMapByModel = $state<Record<string, ThinkingLevelMap | null>>({});
  let messages = $state<Message[]>([
    {
      id: 'system-1',
      role: 'system',
      content: 'Pisidian 已准备好处理当前笔记上下文。',
      timestamp: Date.now(),
    },
  ]);

  const thinkingLevels: SelectOption[] = [];

  /** 是否有真实对话消息（排除 system 提示和工作目录切换） */
  const hasRealMessages = $derived(
    messages.some((m) => m.id !== 'system-1' && !m.id.startsWith('workdir-')),
  );
  /** 欢迎态文本（居中显示的系统消息） */
  const welcomeLines = $derived(
    messages
      .filter((m) => m.id === 'system-1' || m.id.startsWith('workdir-'))
      .map((m) => m.content),
  );
  const displayMessages = $derived(
    hasRealMessages
      ? messages.filter((m) => m.id !== 'system-1' && !m.id.startsWith('workdir-'))
      : [],
  );
  const messageStream = $derived(splitStreamingMessage(displayMessages));

  /** 从 pi get_state 返回的模型名匹配 model list，作为初始选中值 */
  const initialModelValue = $derived.by(() => {
    if (!sessionStats?.modelLabel) return undefined;
    const label = sessionStats.modelLabel.toLowerCase();
    for (const group of models) {
      for (const m of group.models) {
        const key = m.value.toLowerCase();
        if (key === label || key.endsWith('/' + label) || ('/' + label) === key.slice(key.lastIndexOf('/'))) {
          return m.value;
        }
      }
    }
    return undefined;
  });

  const statusText = $derived.by<string>(() => {
    if (!sessionStats?.contextPercent || !sessionStats?.contextWindow) return '0%/0M';
    return `${sessionStats.contextPercent.toFixed(1)}%/${formatToken(sessionStats.contextWindow)}`;
  });

  function formatToken(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(0) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k';
    return String(n);
  }

  function obsidianIcon(node: HTMLElement, icon: string) {
    setIcon(node, icon);

    return {
      update(nextIcon: string) {
        node.empty();
        setIcon(node, nextIcon);
      },
    };
  }

  let msgCounter = 0;
  let contentEl: HTMLDivElement | undefined = $state();
  let piSession: PiSession | null = $state(null);
  let workDir = $state('');
  let isStreaming = $state(false);
  let sessionStats: SessionStats | null = $state(null);
  let selectedText: SelectedContext | null = $state(null);
  let showSessionList = $state(false);
  let sessions = $state<SessionInfo[]>([]);
  let loadedSessionPath: string | null = $state(null);

  // 在 mouseup 时缓存 Obsidian 编辑器中的选区，避免焦点转移后选区丢失
  let cachedSelection: SelectedContext | null = null;

  function captureSelection() {
    if (!app) return;
    const editor = app.workspace.activeEditor;
    if (!editor) {
      cachedSelection = null;
      return;
    }
    const selected = editor.getSelection();
    if (!selected.trim()) {
      cachedSelection = null;
      return;
    }
    const activeFile = app.workspace.getActiveFile();
    const maxLen = settings?.selectionMaxLength ?? 5000;
    const snippet = selected.length > maxLen
      ? selected.slice(0, maxLen)
      : selected;
    cachedSelection = {
      text: snippet,
      source: activeFile?.name ?? '未命名',
    };
  }

  function onEditorFocus() {
    if (!settings?.autoAttachSelection) return;
    if (cachedSelection) {
      selectedText = cachedSelection;
    }
  }

  function clearSelectedText() {
    selectedText = null;
  }

  async function handleRefresh() {
    modelsLoading = true;
    try {
      const result = await listModels();
      models = result.models;
      thinkingLevelMapByModel = result.thinkingLevelMapByModel;
      piAvailable = true;
    } catch (error) {
      console.warn('[pisidian] Failed to refresh model list:', error);
    } finally {
      modelsLoading = false;
    }
    void piSession?.fetchStats().then((stats) => {
      if (stats.modelLabel) sessionStats = stats;
    }).catch(() => {});
  }

  function toggleSessionList() {
    showSessionList = !showSessionList;
    if (showSessionList) {
      sessions = piSession?.listSessions() ?? [];
    }
  }

  function closeSessionList() {
    showSessionList = false;
  }

  function getSessionTitle(session: SessionInfo): string {
    return session.title || session.name || session.id;
  }

  function handleDeleteSession(session: SessionInfo) {
    const deleted = piSession?.deleteSession(session.path) ?? false;
    if (!deleted) {
      console.warn('[pisidian] Failed to delete session:', session.path);
      return;
    }
    sessions = sessions.filter((item) => item.path !== session.path);
    if (loadedSessionPath === session.path || piSession?.sessionFile === session.path) {
      messages = [];
      loadedSessionPath = null;
    }
  }

  function handleLoadSession(session: SessionInfo) {
    isStreaming = false;
    piSession?.abort();
    messages = [];
    loadedSessionPath = session.path;
    messages = piSession?.switchSession(session.path) ?? [];
    closeSessionList();
  }

  /** 格式化相对时间 */
  function formatRelativeTime(mtime: number): string {
    const diff = Date.now() - mtime;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins} 分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} 天前`;
    return new Date(mtime).toLocaleDateString();
  }

  async function handleNewSession() {
    // 中止正在进行的请求
    piSession?.abort();
    isStreaming = false;
    clearSelectedText();
    // 清空消息列表
    messages = [{
      id: 'system-1',
      role: 'system',
      content: 'Pisidian 已准备好处理当前笔记上下文。',
      timestamp: Date.now(),
    }];
    loadedSessionPath = null;
    msgCounter = 0;
    // 等待 pi 进程完成新会话创建
    await piSession?.newSession();
  }

  async function handleWorkDirChange(nextWorkDir: string) {
    if (!nextWorkDir || nextWorkDir === workDir) return;

    piSession?.abort();
    piSession?.dispose();
    isStreaming = false;
    workDir = nextWorkDir;
    loadedSessionPath = null;
    sessionStats = null;
    msgCounter = 0;
    messages = [createWorkDirMessage(nextWorkDir)];

    const nextSession = new PiSession(nextWorkDir);
    piSession = nextSession;
    try {
      await nextSession.newSession();
    } catch (error) {
      console.warn('[pisidian] Failed to create session for work dir:', error);
    }

  }

  /** 滚动到消息列表底部 */
  async function scrollToBottom() {
    await tick();
    if (contentEl) {
      contentEl.scrollTo({ top: contentEl.scrollHeight, behavior: 'smooth' });
    }
  }

  // 每当 messages 变化时自动滚到底部
  $effect(() => {
    // 读取 messages 以建立依赖
    void messages.length;
    void messageStream.streamingMessage?.content;
    void scrollToBottom();
  });

  async function handleSubmit(input: { text: string; attachments: Attachment[] }) {
    const userText = input.text.trim();
    if (!userText && input.attachments.length === 0) return;

    msgCounter += 1;

    // ---- 构建用户消息内容（含附件信息）----
    let userContent = userText;
    let piMessage = userText;

    if (input.attachments.length > 0) {
      const fileNames = input.attachments.map((a) => a.name);
      // 读取所有文本附件的内容
      const fileContents: string[] = [];
      for (const att of input.attachments) {
        if (att.type === 'text' && att.fileObj) {
          try {
            const text = await att.fileObj.text();
            fileContents.push(`--- ${att.name} ---\n${text}`);
          } catch {
            fileContents.push(`--- ${att.name} ---\n(读取失败)`);
          }
        } else if (att.type === 'image') {
          fileContents.push(`[图片: ${att.name}]`);
        }
      }

      const fileList = fileNames.join('\n');
      userContent = userText
        ? `${userText}\n\n---\n附件: \n${fileList}`
        : `附件: \n${fileList}`;

      if (fileContents.length > 0) {
        piMessage = userText
          ? `${userText}\n\n用户上传了以下文件内容：\n\n${fileContents.join('\n\n')}`
          : `用户上传了以下文件内容：\n\n${fileContents.join('\n\n')}`;
      }
    }

    // 拼接选区上下文
    if (selectedText) {
      const selectionSuffix = `\n\n--- 上下文 来自 ${selectedText.source} ---\n${selectedText.text}`;
      piMessage = piMessage ? `${piMessage}${selectionSuffix}` : selectionSuffix.trim();

      const userSelectionNote = `\n\n已选择 ${selectedText.text.length} 字:\n${selectedText.text}`;
      userContent = userContent ? `${userContent}${userSelectionNote}` : userSelectionNote.trim();
    }

    clearSelectedText();

    // ---- 用户消息 ----
    const userMsg: Message = {
      id: `user-${msgCounter}`,
      role: 'user',
      content: userContent,
      timestamp: Date.now(),
    };

    // ---- 流式占位 ----
    const assistantId = `assistant-${msgCounter}`;
    let firstDelta = true;
    const streamingMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '请稍后...',
      timestamp: Date.now(),
      isStreaming: true,
    };

    // ---- 开始流式请求 ----
    isStreaming = true;

    messages = [...messages, userMsg, streamingMsg];

    piSession!.sendMessage(piMessage, {
      timeoutMs: 60_000,
      onDelta: (delta) => {
        messages = messages.map((m) => {
          if (m.id !== assistantId) return m;
          const base = firstDelta ? '' : m.content;
          firstDelta = false;
          return { ...m, content: base + delta };
        });
      },
    })
      .then((result) => {
        if (result.stats) sessionStats = result.stats;
        messages = messages.map((m) => {
          if (m.id === assistantId) {
            return { ...m, content: result.text, isStreaming: false };
          }
          // 折叠最后一条 user 消息
          if (m.role === 'user' && m.id === `user-${msgCounter}`) {
            return { ...m, collapsed: true };
          }
          return m;
        });
      })
      .catch((error) => {
        if ((error as DOMException).name === 'AbortError') {
          // 用户主动中止，不做特殊处理
          messages = messages.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + '\n\n[已中止]', isStreaming: false } : m,
          );
        } else {
          console.error('[pisidian] RPC error:', error);
          const errorMsg: Message = {
            id: `error-${msgCounter}`,
            role: 'error',
            content: `请求失败: ${(error as Error).message ?? String(error)}`,
            timestamp: Date.now(),
          };
          messages = messages.map((m) =>
            m.id === assistantId ? errorMsg : m,
          );
        }
      })
      .finally(() => {
        isStreaming = false;
      });
  }

  onMount(() => {
    let cancelled = false;

    modelsLoading = true;
    void listModels()
      .then((result) => {
        if (!cancelled) {
          models = result.models;
          thinkingLevelMapByModel = result.thinkingLevelMapByModel;
        }
      })
      .catch((error) => {
        console.warn('Failed to load pi model list', error);
        if (!cancelled) piAvailable = false;
      })
      .finally(() => {
        if (!cancelled) modelsLoading = false;
      });

    // 初始化持久化 pi session
    const initialWorkDir = getInitialWorkDir(vaultPath);
    workDir = initialWorkDir;
    piSession = new PiSession(initialWorkDir);

    void piSession.fetchStats()
      .then((stats) => {
        if (!cancelled && stats.modelLabel) {
          sessionStats = stats;
        }
      })
      .catch(() => {
        // 静默失败，不影响使用
      });

    // 监听 mouseup 以缓存编辑器选区（不依赖 focus 时序）
    window.addEventListener('mouseup', captureSelection);

    return () => {
      cancelled = true;
      piSession?.dispose();
      window.removeEventListener('mouseup', captureSelection);
    };
  });
</script>

<div class="pisidian-wrapper">
  <div class="pisidian-header">
    <div class="pisidian-title">
      <svg class="pi-logo-mark" viewBox="0 0 800 800" aria-hidden="true" focusable="false">
        <path fill="currentColor" fill-rule="evenodd" d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"></path>
        <path fill="currentColor" d="M517.36 400H634.72V634.72H517.36Z"></path>
      </svg>
      <span>Pisidian</span>
    </div>
    <div class="pisidian-header-actions">
      <button type="button" class="clickable-icon pisidian-header-btn" aria-label="新会话" use:obsidianIcon={'plus'} onclick={handleNewSession}></button>
      <button type="button" class="clickable-icon pisidian-header-btn" aria-label="刷新" use:obsidianIcon={'refresh-cw'} onclick={handleRefresh}></button>
      <button type="button" class="clickable-icon pisidian-header-btn" aria-label="会话列表" use:obsidianIcon={'ellipsis-vertical'} onclick={toggleSessionList}></button>
    </div>
  </div>

  <div class="pisidian-content" bind:this={contentEl}>
    {#if hasRealMessages || messageStream.streamingMessage}
      <div class="message-stack">
        <MessageList messages={messageStream.stableMessages} collapseThreshold={settings?.collapseThreshold} />
        {#if messageStream.streamingMessage}
          <StreamingMessage message={messageStream.streamingMessage} />
        {/if}
      </div>
    {:else}
      <div class="pisidian-welcome">
        {#each welcomeLines as line}
          <p>{line}</p>
        {/each}
      </div>
    {/if}
  </div>

  <div class="pisidian-footer">
    <div class="context-info">
      <span class="context-info__path">{workDir}</span>
      <span class="context-info__stats">{statusText}</span>
    </div>
    <MessageEditor
      {models}
      {modelsLoading}
      initialModelValue
      {thinkingLevelMapByModel}
      {thinkingLevels}
      {selectedText}
      {vaultPath}
      {workDir}
      {isStreaming}
      onFocus={onEditorFocus}
      onClearSelection={clearSelectedText}
      onSubmit={handleSubmit}
      onStop={() => piSession?.abort()}
      onWorkDirChange={handleWorkDirChange}
    />
  </div>

  {#if showSessionList}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="pisidian-session-overlay" onclick={closeSessionList}>
      <div class="pisidian-session-panel" onclick={(e) => e.stopPropagation()}>
        <div class="pisidian-session-panel-header">
          <span>会话列表</span>
          <button type="button" class="clickable-icon pisidian-session-panel-close-btn" aria-label="关闭" use:obsidianIcon={'x'} onclick={closeSessionList}></button>
        </div>
        <div class="pisidian-session-panel-body">
          {#if sessions.length === 0}
            <div class="pisidian-session-empty">暂无历史会话</div>
          {:else}
            {#each sessions as session}
              {@const isActive = loadedSessionPath === session.path || piSession?.sessionFile === session.path}
              <div
                class="pisidian-session-item"
                class:pisidian-session-item--active={isActive}
                role="button"
                tabindex="0"
                onclick={() => handleLoadSession(session)}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleLoadSession(session);
                  }
                }}
              >
                <div class="pisidian-session-item-info">
                  <span class="pisidian-session-item-name" title={getSessionTitle(session)}>{getSessionTitle(session)}</span>
                  {#if session.messageCount}
                    <span class="pisidian-session-item-count">{session.messageCount} 条消息</span>
                  {/if}
                </div>
                <span class="pisidian-session-item-time">{formatRelativeTime(session.mtime)}</span>
                <button
                  type="button"
                  class="clickable-icon pisidian-session-item-delete"
                  aria-label="删除会话"
                  use:obsidianIcon={'trash-2'}
                  onclick={(e) => {
                    e.stopPropagation();
                    handleDeleteSession(session);
                  }}
                ></button>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if !piAvailable}
    <div class="pisidian-blocked">
      <div class="pisidian-blocked-content">
        <svg class="pi-logo-mark" viewBox="0 0 800 800" aria-hidden="true" focusable="false">
          <path fill="currentColor" fill-rule="evenodd" d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"></path>
          <path fill="currentColor" d="M517.36 400H634.72V634.72H517.36Z"></path>
        </svg>
        <p class="pisidian-blocked-title">未检测到 pi-coding-agent</p>
        <p class="pisidian-blocked-hint">请确保已安装并可执行 <code>pi</code> 命令</p>
        <button type="button" class="mod-cta" onclick={handleRefresh}>
          <span use:obsidianIcon={'refresh-cw'}></span>
          重新检查
        </button>
      </div>
    </div>
  {/if}
</div>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') closeSessionList(); }} />
