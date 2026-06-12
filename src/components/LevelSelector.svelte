<script lang="ts">
  import SelectDropdown from './SelectDropdown.svelte';
  import type { SelectOption } from '../types';

  let { levels, value, disabled = false, placeholder = '级别', onChange }: {
    levels: SelectOption[];
    value: string;
    disabled?: boolean;
    placeholder?: string;
    onChange: (value: string) => void;
  } = $props();

  const options = $derived(
    levels.map((l) => ({
      value: l.value,
      label: l.label,
      disabled: l.disabled,
    })),
  );
</script>

<SelectDropdown
  {value}
  {options}
  {disabled}
  {placeholder}
  {onChange}
/>
