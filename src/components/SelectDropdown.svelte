<script lang="ts">
  import { Brain, ChevronDown } from '@lucide/svelte';

  interface DropdownOption {
    value: string;
    label: string;
    disabled?: boolean;
    badges?: string[];
  }

  interface GroupedOption extends DropdownOption {
    group?: string;
  }

  let {
    value,
    options,
    placeholder = '',
    icon,
    searchable = false,
    searchPlaceholder = '过滤...',
    disabled = false,
    variant = 'default',
    onChange,
  }: {
    value: string;
    options: GroupedOption[];
    placeholder?: string;
    icon?: 'brain';
    searchable?: boolean;
    searchPlaceholder?: string;
    disabled?: boolean;
    variant?: 'default' | 'model';
    onChange: (value: string) => void;
  } = $props();

  let open = $state(false);
  let query = $state('');
  let triggerEl: HTMLButtonElement | undefined = $state();
  let panelEl: HTMLDivElement | undefined = $state();
  let searchEl: HTMLInputElement | undefined = $state();

  const normalizedQuery = $derived(query.trim().toLowerCase());
  const filteredOptions = $derived(
    normalizedQuery
      ? options.filter((option) =>
          `${option.group ?? ''} ${option.label} ${option.value}`
            .toLowerCase()
            .includes(normalizedQuery),
        )
      : options,
  );

  const groups = $derived.by(() => {
    const seen = new Set<string | null>();
    const result: (string | null)[] = [];
    for (const opt of filteredOptions) {
      const g = opt.group ?? null;
      if (!seen.has(g)) {
        seen.add(g);
        result.push(g);
      }
    }
    return result;
  });

  const selectedLabel = $derived(
    options.find((o) => o.value === value)?.label ?? '',
  );

  function toggle() {
    if (disabled) return;
    open = !open;
    if (open && searchable) {
      query = '';
      setTimeout(() => searchEl?.focus(), 0);
    }
  }

  function select(val: string) {
    open = false;
    query = '';
    if (val !== value) {
      onChange(val);
    }
    triggerEl?.focus();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      open = false;
      query = '';
      triggerEl?.focus();
    }
  }

  function handleTriggerKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) toggle();
    }
    if (e.key === 'Escape') {
      open = false;
      query = '';
    }
  }

  function handleClickOutside(e: MouseEvent) {
    if (!open) return;
    if (
      triggerEl && !triggerEl.contains(e.target as Node) &&
      panelEl && !panelEl.contains(e.target as Node)
    ) {
      open = false;
      query = '';
    }
  }

  $effect(() => {
    if (open) {
      document.addEventListener('click', handleClickOutside, true);
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('click', handleClickOutside, true);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="select-dropdown" class:select-dropdown--open={open} class:select-dropdown--model={variant === 'model'}>
  <button
    bind:this={triggerEl}
    type="button"
    {disabled}
    class="select-dropdown__trigger"
    class:select-dropdown__trigger--open={open}
    onclick={toggle}
    onkeydown={handleTriggerKeyDown}
    aria-haspopup="listbox"
    aria-expanded={open}
  >
    {#if icon === 'brain'}
      <Brain class="select-dropdown__icon" size={13} />
    {/if}
    <span class="select-dropdown__trigger-content">
      <span class="select-dropdown__label">
        {selectedLabel || placeholder}
      </span>
    </span>
    <span class="select-dropdown__arrow" class:select-dropdown__arrow--open={open}>
      <ChevronDown size={12} />
    </span>
  </button>

  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={panelEl}
      class="select-dropdown__panel"
      role="listbox"
    >
      {#if searchable}
        <div class="select-dropdown__search-wrap">
          <input
            bind:this={searchEl}
            bind:value={query}
            type="text"
            class="select-dropdown__search"
            placeholder={searchPlaceholder}
            onkeydown={(event) => event.stopPropagation()}
          />
        </div>
      {/if}
      <div class="select-dropdown__list">
        {#each groups as group}
          {#if group !== null}
            <div class="select-dropdown__group-label">{group}</div>
          {/if}
          {#each filteredOptions.filter((o) => (o.group ?? null) === group) as opt}
            <button
              type="button"
              role="option"
              class="select-dropdown__option"
              class:select-dropdown__option--selected={opt.value === value}
              disabled={opt.disabled}
              aria-selected={opt.value === value}
              onclick={() => select(opt.value)}
            >
              <span class="select-dropdown__option-content">
                <span class="select-dropdown__option-label">{opt.label}</span>
                {#if opt.badges?.length}
                  <span class="select-dropdown__badges" aria-hidden="true">
                    {#each opt.badges as badge}
                      <span class="select-dropdown__badge">{badge}</span>
                    {/each}
                  </span>
                {/if}
              </span>
            </button>
          {/each}
        {/each}
        {#if filteredOptions.length === 0}
          <div class="select-dropdown__empty">没有匹配的模型</div>
        {/if}
      </div>
    </div>
  {/if}
</div>
