<script lang="ts">
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

  function requestSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await onSave(local);
    }, 300);
  }
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
        value={local.piPath}
        placeholder="自动检测"
        oninput={(e) => {
          local.piPath = (e.target as HTMLInputElement).value;
          requestSave();
        }}
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
        value={local.collapseThreshold}
        min="0"
        max="1000"
        step="10"
        oninput={(e) => {
          local.collapseThreshold = Number((e.target as HTMLInputElement).value);
          requestSave();
        }}
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
