<script lang="ts">
  import type { SlashCommandOption } from '../types';

  let { commands, onSelect }: {
    commands: SlashCommandOption[];
    onSelect: (command: SlashCommandOption) => void;
  } = $props();
</script>

<div class="slash-menu">
  <div class="slash-menu__scroll">
    {#if commands.length === 0}
      <div class="slash-menu__empty">没有匹配的 Skill</div>
    {:else}
      <div class="slash-menu__list">
        <div class="slash-menu__category">Skills</div>
        {#each commands as command (command.id)}
          <button
            type="button"
            class="slash-menu__item"
            onclick={() => onSelect(command)}
          >
            <div class="slash-menu__item-content">
              <span class="slash-menu__item-label">{command.label}</span>
              {#if command.description}
                <span class="slash-menu__item-desc">{command.description}</span>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
