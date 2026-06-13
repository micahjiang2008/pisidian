<script lang="ts">
  import { onMount } from 'svelte';
  import type { PisidianSettings } from '../settings';
  import { DEFAULT_SETTINGS } from '../settings';

  interface Props {
    settings: PisidianSettings;
    piVersion?: string;
    onSave: (settings: PisidianSettings) => Promise<void>;
  }

  let { settings, piVersion, onSave }: Props = $props();

  let local: PisidianSettings = $state({ ...DEFAULT_SETTINGS });
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    local = { ...settings };
  });

  function autoSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await onSave(local);
    }, 300);
  }

  // Trigger autoSave on any local change
  $effect(() => {
    void local.piPath;
    void local.autoAttachFile;
    void local.autoAttachSelection;
    void local.selectionMaxLength;
    void local.collapseThreshold;
    autoSave();
  });
</script>

<div class="pisidian-settings-page">
  <h2>Pisidian 设置</h2>

  <!-- Pi 可执行文件路径 -->
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">Pi 可执行文件路径</div>
      <div class="setting-item-description">
        留空则自动检测 PATH 中的 <code>pi</code> 命令
        {#if piVersion}
          <span class="setting-item-version">（当前: {piVersion}）</span>
        {/if}
      </div>
    </div>
    <div class="setting-item-control">
      <input
        type="text"
        bind:value={local.piPath}
        placeholder="自动检测"
      />
    </div>
  </div>

  <!-- 自动附加文件 -->
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">自动附加当前文件</div>
      <div class="setting-item-description">打开 .md 文件时自动将其附加到编辑器</div>
    </div>
    <div class="setting-item-control">
      <div
        class="checkbox-container"
        class:is-enabled={local.autoAttachFile}
        role="switch"
        aria-checked={local.autoAttachFile}
        tabindex="0"
        onclick={() => local.autoAttachFile = !local.autoAttachFile}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); local.autoAttachFile = !local.autoAttachFile; } }}
      >
        <input type="checkbox" tabindex="-1" checked={local.autoAttachFile} />
      </div>
    </div>
  </div>

  <!-- 自动附加选区 -->
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">自动附加选区</div>
      <div class="setting-item-description">点选输入框时自动附加编辑器中的选中文本</div>
    </div>
    <div class="setting-item-control">
      <div
        class="checkbox-container"
        class:is-enabled={local.autoAttachSelection}
        role="switch"
        aria-checked={local.autoAttachSelection}
        tabindex="0"
        onclick={() => local.autoAttachSelection = !local.autoAttachSelection}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); local.autoAttachSelection = !local.autoAttachSelection; } }}
      >
        <input type="checkbox" tabindex="-1" checked={local.autoAttachSelection} />
      </div>
    </div>
  </div>

  <!-- 选区最大字数 -->
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">选区最大字数</div>
      <div class="setting-item-description">超过此字数的选区将被截断</div>
    </div>
    <div class="setting-item-control">
      <input
        type="number"
        bind:value={local.selectionMaxLength}
        min="100"
        max="50000"
        step="100"
      />
    </div>
  </div>

  <!-- 折叠阈值 -->
  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">用户消息折叠阈值（字）</div>
      <div class="setting-item-description">超过此长度的用户消息将被折叠。设为 0 则不折叠</div>
    </div>
    <div class="setting-item-control">
      <input
        type="number"
        bind:value={local.collapseThreshold}
        min="0"
        max="1000"
        step="10"
      />
    </div>
  </div>
</div>

<style>
  .pisidian-settings-page {
    padding: 16px 8px;
  }

  h2 {
    margin: 0 0 16px;
    font-size: var(--font-text-size);
    font-weight: 600;
  }

  .setting-item {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 12px 0;
    border-top: 1px solid var(--background-modifier-border);
  }

  .setting-item:last-child {
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .setting-item-info {
    flex: 1;
    min-width: 0;
  }

  .setting-item-name {
    font-size: var(--font-smaller);
    font-weight: 500;
    color: var(--text-normal);
  }

  .setting-item-description {
    font-size: var(--font-smallest);
    color: var(--text-muted);
    margin-top: 2px;
  }

  .setting-item-version {
    color: var(--text-accent);
  }

  .setting-item-control {
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  input[type='text'],
  input[type='number'] {
    width: 200px;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: var(--font-smaller);
  }

  input[type='number'] {
    width: 100px;
  }

  input:focus {
    border-color: var(--interactive-accent);
    outline: none;
  }
</style>
