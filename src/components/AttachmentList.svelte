<script lang="ts">
  import AttachmentTile from './AttachmentTile.svelte';
  import type { Attachment } from '../types';

  let { attachments, onRemove }: {
    attachments: Attachment[];
    onRemove?: (attachmentId: string) => void;
  } = $props();
</script>

{#if attachments.length > 0}
  <div class="attachment-list">
    {#each attachments as att (att.id)}
      <AttachmentTile attachment={att} {onRemove} />
    {/each}
  </div>
{/if}
