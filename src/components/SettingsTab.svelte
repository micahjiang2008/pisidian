<script lang="ts">
  import { onMount } from 'svelte';
  import type { PisidianSettings } from '../settings';
  import { DEFAULT_SETTINGS } from '../settings';

  interface Props {
    settings: PisidianSettings;
    onSave: (settings: PisidianSettings) => Promise<void>;
  }

  let { settings, onSave }: Props = $props();

  let local: PisidianSettings = $state({ ...DEFAULT_SETTINGS });

  $effect(() => {
    local = { ...settings };
  });

  async function save() {
    await onSave(local);
  }

  // Support Ctrl+S
  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="pisidian-settings-page">
  <h2>Pisidian 设置</h2>

  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name">问候语</div>
      <div class="setting-item-description">在状态栏显示的文本</div>
    </div>
    <div class="setting-item-control">
      <input
        type="text"
        bind:value={local.greeting}
        placeholder={DEFAULT_SETTINGS.greeting}
      />
    </div>
  </div>

  <div class="setting-item">
    <div class="setting-item-info">
      <div class="setting-item-name"></div>
    </div>
    <div class="setting-item-control">
      <button type="button" class="mod-cta" onclick={save}>保存</button>
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

  .setting-item-control {
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  input[type='text'] {
    width: 240px;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: var(--font-smaller);
  }

  input[type='text']:focus {
    border-color: var(--interactive-accent);
    outline: none;
  }
</style>
