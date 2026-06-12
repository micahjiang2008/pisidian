<script lang="ts">
  import { Brain } from '@lucide/svelte';
  import type { Message } from '../../types';

  let { message }: {
    message: Message;
  } = $props();
</script>

<div class="message message--thinking">
  <div class="message__bubble message__bubble--thinking">
    <div class="message__header message__header--thinking">
      <Brain size={14} />
      <span>思考中…</span>
    </div>
    {#if message.content}
      <div class="message__content message__content--thinking">{message.content}</div>
    {/if}
  </div>
</div>
