<script lang="ts">
  import SelectDropdown from './SelectDropdown.svelte';
  import type { ModelProviderOption } from '../types';

  let { models, value, disabled = false, loading = false, onChange }: {
    models: ModelProviderOption[];
    value: string;
    disabled?: boolean;
    loading?: boolean;
    onChange: (value: string) => void;
  } = $props();

  const options = $derived(
    models.flatMap((g) =>
      g.models.map((m) => ({
        value: m.value,
        label: m.label,
        disabled: m.disabled,
        badges: m.badges,
        group: g.provider,
      })),
    ),
  );
</script>

<SelectDropdown
  {value}
  {options}
  disabled={disabled || loading}
  placeholder={loading ? '加载中...' : '模型'}
  searchable={true}
  searchPlaceholder="过滤模型..."
  variant="model"
  {onChange}
/>
