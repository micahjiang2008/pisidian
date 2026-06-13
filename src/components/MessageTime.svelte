<script lang="ts">
  let { timestamp }: { timestamp: number } = $props();

  const formatted = $derived.by(() => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const pad = (n: number) => String(n).padStart(2, '0');
    const HH = pad(date.getHours());
    const mm = pad(date.getMinutes());

    if (isToday) {
      return `${HH}:${mm}`;
    }
    const yyyy = date.getFullYear();
    const MM = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    return `${yyyy}-${MM}-${dd} ${HH}:${mm}`;
  });
</script>

<span class="message__time">{formatted}</span>
