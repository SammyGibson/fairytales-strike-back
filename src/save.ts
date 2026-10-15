const KEY = "fairytales-save-v1";
const SETTINGS_KEY = "fairytales-settings-v1";

/** Progress through the level, saved at checkpoints and when pausing. */
export type SaveData = {
  level: number;
  checkpoint: number;
  hearts: number;
  defeatedZombies: number[];
  heartsTaken: number[];
  /** Bosses beaten so far in the current level's line-up. */
  bossesDefeated: number;
};

export type Settings = {
  muted: boolean;
  /** Earned by beating Fire Rose; kept across levels and new games. */
  flameSword: boolean;
  flameEquipped: boolean;
};

const DEFAULT_SETTINGS: Settings = { muted: false, flameSword: false, flameEquipped: false };

export function loadGame(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<SaveData>;
    if (typeof data.checkpoint !== "number" || !Array.isArray(data.defeatedZombies)) return null;
    return {
      level: data.level ?? 1,
      checkpoint: data.checkpoint,
      hearts: typeof data.hearts === "number" ? data.hearts : 6,
      defeatedZombies: data.defeatedZombies.filter((n): n is number => typeof n === "number"),
      heartsTaken: Array.isArray(data.heartsTaken) ? data.heartsTaken.filter((n): n is number => typeof n === "number") : [],
      bossesDefeated: typeof data.bossesDefeated === "number" ? data.bossesDefeated : 0,
    };
  } catch {
    return null;
  }
}

export function saveGame(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable (private window); the game still plays, it just won't resume.
  }
}

export function clearGame(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Fall through to defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings are a convenience; ignore storage failures.
  }
}
