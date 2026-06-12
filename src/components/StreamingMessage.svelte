<script lang="ts">
  import AssistantMessage from './messages/AssistantMessage.svelte';
  import type { Message } from '../types';

  let { message }: {
    message?: Message;
  } = $props();
</script>

{#if message && message.role === 'assistant'}
  <div class="streaming-message">
    <AssistantMessage message={{ ...message, isStreaming: true }} showCursor={true} />
  </div>
{/if}
