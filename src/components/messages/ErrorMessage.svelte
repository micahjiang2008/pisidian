<script lang="ts">
  import type { Message } from '../../types';

  let { message }: {
    message: Message;
  } = $props();
</script>

<div class="message message--error">
  <div class="message__bubble message__bubble--error">
    {message.content}
  </div>
</div>
