<script lang="ts">
  import { ArrowUp, Folder, Plus, Square } from '@lucide/svelte';
  import AttachmentList from './AttachmentList.svelte';
  import LevelSelector from './LevelSelector.svelte';
  import ModelSelector from './ModelSelector.svelte';
  import type { Attachment, ModelProviderOption, SelectOption, ThinkingLevelMap } from '../types';

  interface Props {
    attachments?: Attachment[];
    models?: ModelProviderOption[];
    modelsLoading?: boolean;
    initialModelValue?: string;
    thinkingLevelMapByModel?: Record<string, ThinkingLevelMap | null>;
    thinkingLevels?: SelectOption[];
    isStreaming?: boolean;
    isProcessingFiles?: boolean;
    disabled?: boolean;
    vaultPath?: string;
    workDir?: string;
    onSubmit?: (input: { text: string; attachments: Attachment[] }) => void;
    onStop?: () => void;
    onWorkDirChange?: (workDir: string) => void | Promise<void>;
  }

  let {
    attachments: initialAttachments = [],
    models = [],
    modelsLoading = false,
    initialModelValue = undefined,
    thinkingLevelMapByModel = {},
    thinkingLevels = [],
    isStreaming = false,
    isProcessingFiles = false,
    disabled = false,
    vaultPath,
    workDir,
    onSubmit,
    onStop,
    onWorkDirChange,
  }: Props = $props();

  let fileInput: HTMLInputElement | undefined = $state();
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let editorEl: HTMLDivElement | undefined = $state();

  let value = $state('');
  let attachments = $state<Attachment[]>([]);
  let didInitAttachments = $state(false);
  let selectedModel = $state('');
  let selectedThinkingLevel = $state('');
  let isDragging = $state(false);

  function getSupportedAttachment(file: File): Attachment | null {
    const fileName = file.name.toLowerCase();
    const isMd = file.type === 'text/markdown' || file.type === 'text/x-markdown' || fileName.endsWith('.md');

    if (!isMd) return null;

    return {
      id: `${file.name}-${file.lastModified}-${file.size}`,
      name: file.name,
      type: 'text',
      size: file.size,
      mimeType: file.type || 'text/markdown',
      extension: 'md',
      fileObj: file,
    };
  }

  function revokePreview(attachment: Attachment) {
    if (attachment.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }

  function appendFiles(files: File[]) {
    const nextAttachments = files
      .map(getSupportedAttachment)
      .filter((a): a is Attachment => a !== null);

    attachments = [...attachments, ...nextAttachments];
  }

  function syncTextareaHeight() {
    if (!textareaEl) return;

    textareaEl.style.height = 'auto';
    const style = getComputedStyle(textareaEl);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const paddingTop = Number.parseFloat(style.paddingTop);
    const paddingBottom = Number.parseFloat(style.paddingBottom);
    const maxHeight = lineHeight * 4 + paddingTop + paddingBottom;
    textareaEl.style.height = `${Math.min(textareaEl.scrollHeight, maxHeight)}px`;
  }

  $effect(() => {
    void value;
    syncTextareaHeight();
  });

  $effect(() => {
    if (didInitAttachments) return;
    attachments = initialAttachments;
    didInitAttachments = true;
  });

  const modelOptions = $derived(models.flatMap((group) => group.models));

  const canSubmit = $derived(
    !disabled && !isStreaming && !isProcessingFiles && (value.trim().length > 0 || attachments.length > 0),
  );

  /** Current model's thinkingLevelMap, or null if model has no reasoning support. */
  const currentThinkingLevelMap = $derived<ThinkingLevelMap | null>(
    thinkingLevelMapByModel[selectedModel] ?? null,
  );

  /** Derived SelectOption[] from the current model's thinkingLevelMap. */
  const dynamicThinkingLevels = $derived.by<SelectOption[]>(() => {
    if (!currentThinkingLevelMap) return [];
    return Object.entries(currentThinkingLevelMap)
      .filter(([, val]) => val !== null)
      .map(([level]) => ({
        value: level,
        label: level,
      }));
  });

  const levelSelectorDisabled = $derived(dynamicThinkingLevels.length === 0);
  const levelSelectorPlaceholder = $derived(dynamicThinkingLevels.length === 0 ? 'off' : '级别');

  function getFirstThinkingLevelForModel(modelValue: string): string {
    const levelMap = thinkingLevelMapByModel[modelValue];
    if (!levelMap) return '';

    return Object.entries(levelMap).find(([, val]) => val !== null)?.[0] ?? '';
  }

  function handleModelChange(nextModel: string) {
    selectedModel = nextModel;
    selectedThinkingLevel = getFirstThinkingLevelForModel(nextModel);
  }

  $effect(() => {
    const firstModel = modelOptions[0]?.value;
    if (!firstModel) {
      selectedModel = '';
      selectedThinkingLevel = '';
      return;
    }

    // 优先使用 pi get_state 返回的当前模型
    if (initialModelValue && modelOptions.some((opt) => opt.value === initialModelValue)) {
      if (selectedModel !== initialModelValue) {
        handleModelChange(initialModelValue);
      }
      return;
    }

    const selectedStillExists = modelOptions.some((option) => option.value === selectedModel);
    if (!selectedStillExists) {
      handleModelChange(firstModel);
    }
  });

  // Reset thinking level when model changes or the selected level is unsupported.
  $effect(() => {
    void selectedModel;
    const selectedStillExists = dynamicThinkingLevels.some((level) => level.value === selectedThinkingLevel);
    if (!selectedStillExists) {
      selectedThinkingLevel = dynamicThinkingLevels[0]?.value ?? '';
    }
  });

  function handleSubmit() {
    if (!canSubmit) return;

    onSubmit?.({ text: value.trim(), attachments });
    value = '';
    attachments.forEach(revokePreview);
    attachments = [];
  }

  function handleKeyDown(event: KeyboardEvent) {
    if ((event as any).isComposing || event.key === 'Process') return;

    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }

    if (event.key === 'Escape' && isStreaming) {
      event.preventDefault();
      onStop?.();
    }
  }

  function handlePaste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length > 0) {
      appendFiles(files);
    }
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    isDragging = true;
  }

  function handleDragLeave(event: DragEvent) {
    if (!editorEl) return;
    const rect = editorEl.getBoundingClientRect();
    const outside =
      event.clientX <= rect.left ||
      event.clientX >= rect.right ||
      event.clientY <= rect.top ||
      event.clientY >= rect.bottom;

    if (outside) {
      isDragging = false;
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    isDragging = false;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      appendFiles(files);
    }
  }

  function removeAttachment(attachmentId: string) {
    const removed = attachments.find((a) => a.id === attachmentId);
    if (removed) {
      revokePreview(removed);
    }
    attachments = attachments.filter((a) => a.id !== attachmentId);
  }

  function getElectronDialog() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require('electron');
      const dialog = electron.dialog ?? electron.remote?.dialog;
      if (dialog?.showOpenDialog) return dialog;
    } catch {
      // ignore
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const remote = require('@electron/remote');
      if (remote.dialog?.showOpenDialog) return remote.dialog;
    } catch {
      // ignore
    }

    throw new Error('Electron dialog API is unavailable');
  }

  async function handleUploadClick() {
    // 在 Electron 中使用 dialog.showOpenDialog 以设置默认目录
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require('path');
      const dialog = getElectronDialog();
      const defaultDir = workDir || vaultPath || '';
      const result = await dialog.showOpenDialog({
        // 构造一个目录内的 .md 路径，强制对话框打开当前工作目录
        defaultPath: path.join(defaultDir, 'file.md'),
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Markdown', extensions: ['md'] },
        ],
      });

      if (!result.canceled && result.filePaths.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('fs');
        const files: File[] = [];
        for (const filePath of result.filePaths) {
          const buffer = fs.readFileSync(filePath);
          const fileName = filePath.split(/[\\/]/).pop() ?? 'file';
          const blob = new Blob([buffer], { type: 'text/markdown' });
          files.push(new File([blob], fileName, { type: 'text/markdown' }));
        }
        appendFiles(files);
      }
    } catch {
      // fallback: 使用原生 file input
      fileInput?.click();
    }
  }

  async function handleWorkDirClick() {
    try {
      const dialog = getElectronDialog();
      const result = await dialog.showOpenDialog({
        defaultPath: workDir || vaultPath || undefined,
        properties: ['openDirectory'],
      });

      const selectedPath = result.filePaths[0];
      if (!result.canceled && selectedPath) {
        await onWorkDirChange?.(selectedPath);
      }
    } catch (error) {
      console.warn('[pisidian] Failed to select work directory:', error);
    }
  }

  function handleFileInputChange() {
    const files = Array.from(fileInput?.files ?? []);
    if (files.length > 0) {
      appendFiles(files);
    }
    if (fileInput) fileInput.value = '';
  }

  $effect(() => {
    return () => {
      attachments.forEach(revokePreview);
    };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={editorEl}
  class="message-editor {isDragging ? 'message-editor--dragging' : ''}"
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  {#if isDragging}
    <div class="message-editor__drop-overlay">
      松开添加文件
    </div>
  {/if}

  {#if attachments.length > 0}
    <div class="message-editor__attachments">
      <AttachmentList {attachments} onRemove={removeAttachment} />
    </div>
  {/if}

  <div class="message-editor__input-area">
    <textarea
      bind:this={textareaEl}
      bind:value={value}
      rows={2}
      {disabled}
      placeholder="输入消息..."
      class="message-editor__textarea"
      onkeydown={handleKeyDown}
      onpaste={handlePaste}
    ></textarea>

  </div>

  <div class="message-editor__toolbar">
    <div class="message-editor__toolbar-left">
      <button
        type="button"
        {disabled}
        aria-label="添加附件"
        class="message-editor__toolbar-btn"
        onclick={handleUploadClick}
      >
        <Plus size={16} />
      </button>
      <button
        type="button"
        {disabled}
        aria-label="打开文件夹"
        class="message-editor__toolbar-btn"
        onclick={handleWorkDirClick}
      >
        <Folder size={16} />
      </button>
    </div>

    <div class="message-editor__toolbar-right">
      <ModelSelector
        {models}
        loading={modelsLoading}
        value={selectedModel}
        {disabled}
        onChange={handleModelChange}
      />

      <LevelSelector
        levels={dynamicThinkingLevels}
        value={selectedThinkingLevel}
        disabled={disabled || levelSelectorDisabled}
        placeholder={levelSelectorPlaceholder}
        onChange={(v) => selectedThinkingLevel = v}
      />

      {#if isStreaming}
        <button
          type="button"
          {disabled}
          aria-label="停止生成"
          class="message-editor__stop-btn"
          onclick={onStop}
        >
          <Square size={16} />
        </button>
      {:else}
        <button
          type="button"
          aria-label="发送消息"
          disabled={!canSubmit}
          class="message-editor__send-btn"
          onclick={handleSubmit}
        >
          <ArrowUp size={16} />
        </button>
      {/if}
    </div>
  </div>

  <input
    bind:this={fileInput}
    type="file"
    multiple
    accept=".md,text/markdown"
    class="hidden"
    onchange={handleFileInputChange}
  />
</div>
