import { Plugin, PluginSettingTab, ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import { mount, unmount } from 'svelte';
import App from './App.svelte';
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
    // Emit custom event so the settings tab can react
    (this.app.workspace as any).trigger('pisidian:settings-changed');
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
    this.svelteComponent = mount(App, {
      target: targetEl,
      props: { vaultPath, app: this.plugin.app },
    }) as unknown as Record<string, any>;

    // Auto-attach the currently focused file when it opens in Obsidian
    this.registerEvent(
      this.plugin.app.workspace.on('file-open', async (file: TFile | null) => {
        if (!file || file.extension !== 'md') return;
        try {
          const content = await this.plugin.app.vault.read(file);
          const blob = new Blob([content], { type: 'text/markdown' });
          const fileObj = new File([blob], file.name, {
            type: 'text/markdown',
            lastModified: file.stat.mtime,
          });
          document.dispatchEvent(
            new CustomEvent('pisidian:auto-attach', { detail: fileObj }),
          );
        } catch (e) {
          console.warn('[pisidian] Failed to auto-attach file:', e);
        }
      }),
    );
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

    // Mount the Svelte component as the settings UI
    const targetEl = containerEl.createDiv({ cls: 'pisidian-settings' });

    const vaultPath = (this.app.vault.adapter as any).basePath;
    this.svelteComponent = mount(App, {
      target: targetEl,
      props: { vaultPath, app: this.app },
    }) as unknown as Record<string, any>;
  }

  hide(): void {
    if (this.svelteComponent) {
      unmount(this.svelteComponent);
    }
  }
}
