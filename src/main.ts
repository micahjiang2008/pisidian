import { Plugin, PluginSettingTab, ItemView, WorkspaceLeaf } from 'obsidian';
import { mount, unmount } from 'svelte';
import App from './App.svelte';
import SettingsTabComponent from './components/SettingsTab.svelte';
import { DEFAULT_SETTINGS } from './settings';
import type { PisidianSettings } from './settings';

const PISIDIAN_ICON = 'brain-circuit';

export default class PisidianPlugin extends Plugin {
  settings: PisidianSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    // Add a settings tab
    this.addSettingTab(new PisidianSettingTab(this.app, this));

    // Add a ribbon icon
    this.addRibbonIcon(PISIDIAN_ICON, 'Pisidian', () => {
      this.activateView();
    });

    // Add a status bar item
    const statusBarItem = this.addStatusBarItem();
    statusBarItem.setText(this.settings.greeting);

    // Listen for settings changes to update the status bar
    this.registerEvent(
      (this.app.workspace as any).on('pisidian:settings-changed', () => {
        statusBarItem.setText(this.settings.greeting);
      }),
    );

    // Register a custom view type
    this.registerView('pisidian-view', (leaf) => new PisidianView(leaf, this));
  }

  onunload() {
    // Cleanup is handled by Obsidian
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Emit custom event so the settings tab and views can react
    (this.app.workspace as any).trigger('pisidian:settings-changed');
    document.dispatchEvent(new CustomEvent('pisidian:settings-changed', { detail: this.settings }));
  }

  activateView() {
    const { workspace } = this.app;

    // If the view is already open, reveal it
    const existingLeaf = workspace.getLeavesOfType('pisidian-view')[0];
    if (existingLeaf) {
      workspace.revealLeaf(existingLeaf);
      return;
    }

    // Otherwise, open a new leaf in the right sidebar
    const rightLeaf = workspace.getRightLeaf(false);
    if (rightLeaf) {
      rightLeaf.setViewState({ type: 'pisidian-view', active: true });
    }
  }
}

class PisidianView extends ItemView {
  private plugin: PisidianPlugin;
  private svelteComponent?: Record<string, any>;

  constructor(leaf: WorkspaceLeaf, plugin: PisidianPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return 'pisidian-view';
  }

  getDisplayText(): string {
    return 'Pisidian';
  }

  getIcon(): string {
    return PISIDIAN_ICON;
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLDivElement;
    container.empty();

    // Create a mount target for Svelte
    const targetEl = container.createDiv({ cls: 'pisidian-view-content' });

    // Mount the Svelte component
    const vaultPath = (this.plugin.app.vault.adapter as any).basePath;
    const settings = this.plugin.settings;
    this.svelteComponent = mount(App, {
      target: targetEl,
      props: { vaultPath, settings },
    }) as unknown as Record<string, any>;
  }

  async onClose() {
    if (this.svelteComponent) {
      unmount(this.svelteComponent);
    }
  }
}

class PisidianSettingTab extends PluginSettingTab {
  private plugin: PisidianPlugin;
  private svelteComponent?: Record<string, any>;

  constructor(app: any, plugin: PisidianPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const targetEl = containerEl.createDiv();
    this.svelteComponent = mount(SettingsTabComponent, {
      target: targetEl,
      props: {
        settings: this.plugin.settings,
        onSave: async (settings: PisidianSettings) => {
          this.plugin.settings = settings;
          await this.plugin.saveSettings();
        },
      },
    }) as unknown as Record<string, any>;
  }

  hide(): void {
    if (this.svelteComponent) {
      unmount(this.svelteComponent);
    }
  }
}
