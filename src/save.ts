const KEY = "fairytales-save-v1";
const SETTINGS_KEY = "fairytales-settings-v1";

/** Progress through the level, saved at checkpoints and when pausing. */
export type SaveData = {
  level: number;
  checkpoint: number;
  hearts: number;
  defeatedZombies: number[];
  heartsTaken: number[];
};

export type Settings = { muted: boolean };

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
    if (raw) return { muted: false, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Fall through to defaults.
  }
  return { muted: false };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings are a convenience; ignore storage failures.
  }
}
