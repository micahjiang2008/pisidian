<script lang="ts">
  import { Check, Copy } from '@lucide/svelte';

  let { text }: { text: string } = $props();

  let copied = $state(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => copied = false, 1500);
    } catch {
      // 静默失败
    }
  }
</script>

<button
  type="button"
  class="clickable-icon message__copy-btn"
  aria-label="复制"
  onclick={handleCopy}
>
  {#if copied}
    <Check size={14} />
  {:else}
    <Copy size={14} />
  {/if}
</button>
