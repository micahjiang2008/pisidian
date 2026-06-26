export interface PisidianSettings {
  piPath: string;
  collapseThreshold: number;
}

export const DEFAULT_SETTINGS: PisidianSettings = {
  piPath: '',
  collapseThreshold: 80,
};
