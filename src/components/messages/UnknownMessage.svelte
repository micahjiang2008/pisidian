<script lang="ts">
  import type { Message } from '../../types';

  let { message }: {
    message: Message;
  } = $props();
</script>

<div class="message message--unknown">
  <div class="message__bubble message__bubble--unknown">
    {message.content}
  </div>
</div>
