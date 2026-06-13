<script lang="ts">
  import CopyButton from '../CopyButton.svelte';
  import MessageTime from '../MessageTime.svelte';
  import type { Message } from '../../types';

  let { message, showCursor = false }: {
    message: Message;
    showCursor?: boolean;
  } = $props();
</script>

<div class="message message--assistant">
  <div class="message__bubble message__bubble--assistant">
    {message.content}
    {#if showCursor}
      <span class="message__cursor" aria-hidden="true"></span>
    {/if}
  </div>

  {#if !message.isStreaming}
    <div class="message__footer">
      <MessageTime timestamp={message.timestamp} />
      <CopyButton text={message.content} />
    </div>
  {/if}

  {#if !message.isStreaming && message.usage}
    <div class="message__usage">
      {#if message.usage.inputTokens != null}
        <span>输入: {message.usage.inputTokens}</span>
      {/if}
      {#if message.usage.outputTokens != null}
        <span>输出: {message.usage.outputTokens}</span>
      {/if}
      {#if message.usage.costUsd != null}
        <span>总计: ~${message.usage.costUsd}</span>
      {/if}
    </div>
  {/if}
</div>
