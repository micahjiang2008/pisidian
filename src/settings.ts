export interface PisidianSettings {
  greeting: string;
  piPath: string;
  autoAttachFile: boolean;
  autoAttachSelection: boolean;
  selectionMaxLength: number;
  collapseThreshold: number;
}

export const DEFAULT_SETTINGS: PisidianSettings = {
  greeting: 'Hello from Pisidian!',
  piPath: '',
  autoAttachFile: true,
  autoAttachSelection: true,
  selectionMaxLength: 5000,
  collapseThreshold: 80,
};
