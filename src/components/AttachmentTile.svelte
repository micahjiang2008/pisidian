<script lang="ts">
  import type { Attachment } from '../types';

  let { attachment, onRemove }: {
    attachment: Attachment;
    onRemove?: (id: string) => void;
  } = $props();

  const displayName = $derived(attachment.name);

  function handleContextMenu(event: MouseEvent) {
    if (!onRemove) return;
    event.preventDefault();
    onRemove(attachment.id);
  }
</script>

<div
  role="button"
  tabindex="-1"
  title="右击移除"
  class="attachment-tile attachment-tile--file"
  oncontextmenu={handleContextMenu}
>
  <div class="attachment-tile__info">
    <div class="attachment-tile__name">{displayName}</div>
  </div>
</div>
