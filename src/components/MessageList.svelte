<script lang="ts">
  import AssistantMessage from './messages/AssistantMessage.svelte';
  import ErrorMessage from './messages/ErrorMessage.svelte';
  import SystemMessage from './messages/SystemMessage.svelte';
  import ThinkingMessage from './messages/ThinkingMessage.svelte';
  import ToolMessage from './messages/ToolMessage.svelte';
  import UnknownMessage from './messages/UnknownMessage.svelte';
  import UserMessage from './messages/UserMessage.svelte';
  import type { Message } from '../types';

  let { messages, collapseThreshold = 80 }: {
    messages: Message[];
    collapseThreshold?: number;
  } = $props();
</script>

<div class="message-list">
  {#each messages as message (message.id)}
    {#if message.role === 'user'}
      <UserMessage {message} {collapseThreshold} />
    {:else if message.role === 'assistant'}
      <AssistantMessage {message} />
    {:else if message.role === 'system'}
      <SystemMessage {message} />
    {:else if message.role === 'thinking'}
      <ThinkingMessage {message} />
    {:else if message.role === 'tool'}
      <ToolMessage {message} />
    {:else if message.role === 'error'}
      <ErrorMessage {message} />
    {:else}
      <UnknownMessage {message} />
    {/if}
  {/each}
</div>
