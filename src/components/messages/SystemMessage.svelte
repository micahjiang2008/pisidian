<script lang="ts">
  import type { Message } from '../../types';

  let { message }: {
    message: Message;
  } = $props();
</script>

<div class="message message--system">
  <div class="message__bubble message__bubble--system">
    {message.content}
  </div>
</div>
