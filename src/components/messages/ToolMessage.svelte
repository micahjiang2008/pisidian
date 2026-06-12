<script lang="ts">
  import { Wrench } from '@lucide/svelte';
  import type { Message } from '../../types';

  let { message }: {
    message: Message;
  } = $props();
</script>

<div class="message message--tool">
  <div class="message__bubble message__bubble--tool">
    <div class="message__header message__header--tool">
      <Wrench size={14} />
      <span class="message__tool-name">{message.toolName ?? 'tool'}</span>
      {#if message.status}
        <span class="message__tool-status">{message.status}</span>
      {/if}
    </div>

    {#if message.content}
      <div class="message__content message__content--tool">
        {message.content}
      </div>
    {/if}
  </div>
</div>
