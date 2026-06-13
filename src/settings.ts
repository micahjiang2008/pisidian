export interface PisidianSettings {
  greeting: string;
  piPath: string;
  collapseThreshold: number;
}

export const DEFAULT_SETTINGS: PisidianSettings = {
  greeting: 'Hello from Pisidian!',
  piPath: '',
  collapseThreshold: 80,
};
