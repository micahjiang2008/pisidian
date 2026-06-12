<script lang="ts">
  import CopyButton from '../CopyButton.svelte';
  import type { Message } from '../../types';

  let { message, collapseThreshold = 80 }: {
    message: Message;
    collapseThreshold?: number;
  } = $props();

  let localCollapsed = $state(false);

  const canCollapse = $derived(collapseThreshold > 0 && message.content.length > collapseThreshold);
  const isCollapsed = $derived(canCollapse && localCollapsed);
  const displayText = $derived(
    isCollapsed ? message.content.slice(0, collapseThreshold) : message.content,
  );

  // 同步外部 collapsed 变化（如历史会话加载）
  $effect(() => {
    if (message.collapsed !== undefined) {
      localCollapsed = message.collapsed;
    }
  });

  function toggle() {
    if (!canCollapse) return;
    localCollapsed = !localCollapsed;
  }
</script>

<div class="message message--user">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="message__bubble message__bubble--user"
    class:message__bubble--collapsed={isCollapsed}
    onclick={toggle}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
    role={canCollapse ? 'button' : undefined}
    tabindex={canCollapse ? 0 : undefined}
    title={canCollapse ? '点击' + (isCollapsed ? '展开' : '收起') : undefined}
  >
    {displayText}
    {#if isCollapsed}
      <span class="message__collapse-hint">... 展开</span>
    {/if}
  </div>

  <CopyButton text={message.content} />
</div>
