import "./style.css";
import type { BossIntro } from "./bosses/boss";
import { Game, MAX_HEARTS } from "./game";
import { LEVEL_COUNT, LEVEL_NAMES } from "./levels";
import { clearGame, loadGame, loadSettings, saveGame, saveSettings } from "./save";
import { GameScene } from "./scene";
import { isMuted, setMuted, sfx } from "./sound";
import { buildAtlas } from "./textures";

const TURN_SPEED = 2.6;
const LOOK_SPEED = 1.6;
const MOUSE_SENSITIVITY = 0.0022;

type State = "loading" | "level-loading" | "menu" | "playing" | "paused" | "options" | "help" | "dead" | "won" | "quit";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("game");
const ui = {
  hud: $("hud"),
  hearts: $("hearts"),
  bossBar: $("boss-bar"),
  bossFill: $("boss-fill"),
  hint: $("controls-hint"),
  hurtFlash: $("hurt-flash"),
  toast: $("toast"),
  menu: $("menu"),
  loading: $("loading"),
  continueBtn: $("btn-continue"),
  pause: $("pause"),
  options: $("options"),
  help: $("help"),
  bossIntro: $("boss-intro"),
  timekeeper: $("timekeeper"),
  tkText: $("tk-text"),
  weapon: $("weapon"),
  weaponName: $("weapon-name"),
  rewardCard: $("reward-card"),
  victory: $("victory"),
  quit: $("quit"),
  soundBtn: $("btn-sound"),
  bossName: $("boss-name"),
  introImg: $<HTMLImageElement>("intro-img"),
  introSmall: $("intro-small"),
  introBig: $("intro-big"),
  victoryText: $("victory-text"),
  nextBtn: $("btn-next"),
  levelLoading: $("level-loading"),
  levelLoadingTitle: $("level-loading-title"),
};
const overlays = [ui.pause, ui.options, ui.help, ui.timekeeper, ui.victory, ui.quit, ui.levelLoading];

const settings = loadSettings();
setMuted(settings.muted);

let state: State = "loading";
let optionsReturn: State = "menu";
let game: Game;
const gs = new GameScene(canvas, buildAtlas());

const keys = new Set<string>();
let mouseBlock = false;

// ---------- Screens ----------

function show(el: HTMLElement | null): void {
  for (const o of overlays) o.hidden = o !== el;
}

function setState(next: State): void {
  state = next;
  ui.menu.hidden = !(next === "menu" || next === "loading");
  ui.hud.hidden = !(next === "playing" || next === "paused" || next === "help" || (next === "options" && optionsReturn === "paused"));
  if (next !== "playing") {
    keys.clear();
    mouseBlock = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

let toastTimeout = 0;
function toast(message: string): void {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => (ui.toast.hidden = true), 2000);
}

const HEART_PATH = "M1 0h2v1h1V0h2v1h1v2H6v1H5v1H4v1H3V5H2V4H1V3H0V1h1z";
let shownHearts = -1;
function renderHearts(hearts: number): void {
  ui.hearts.replaceChildren(
    ...Array.from({ length: MAX_HEARTS }, (_, i) => {
      const full = i < hearts;
      const span = document.createElement("span");
      if (full && i === hearts - 1 && hearts > shownHearts && shownHearts >= 0) span.className = "pop";
      span.innerHTML = `<svg viewBox="-0.5 -0.5 8 7" shape-rendering="crispEdges"><path d="${HEART_PATH}" fill="${full ? "#e8303f" : "#2b2033"}" stroke="#120d0a" stroke-width="0.45"/>${full ? '<path d="M1 1h1v1H1z" fill="#ff9aa4"/>' : ""}</svg>`;
      return span;
    }),
  );
  ui.hearts.setAttribute("aria-label", `${hearts} of ${MAX_HEARTS} hearts`);
  shownHearts = hearts;
}

function updateContinue(): void {
  ui.continueBtn.classList.toggle("disabled", loadGame() === null);
}

function updateSoundButton(): void {
  ui.soundBtn.textContent = isMuted() ? "🔇 Sound: Off" : "🔊 Sound: On";
}

let hintTimeout = 0;
function showHint(): void {
  ui.hint.classList.remove("faded");
  clearTimeout(hintTimeout);
  hintTimeout = window.setTimeout(() => ui.hint.classList.add("faded"), 12000);
}

// ---------- Time Keeper ----------

const TK_LINES = [
  "Tick, tock… oh dear, that didn't go to plan!",
  "Tick, tock… even heroes need a second go sometimes.",
  "Tick, tock… don't worry, time is on your side!",
];
let typeTimer = 0;

function showTimeKeeper(): void {
  setState("dead");
  show(ui.timekeeper);
  const line = `${TK_LINES[Math.floor(Math.random() * TK_LINES.length)]} I am the Time Keeper, and I can turn back the clock to your last save. Would you like a second chance?`;
  // Type the words out like a storybook character talking.
  let i = 0;
  ui.tkText.textContent = "";
  window.clearInterval(typeTimer);
  typeTimer = window.setInterval(() => {
    i += 2;
    ui.tkText.textContent = line.slice(0, i);
    if (i >= line.length) window.clearInterval(typeTimer);
  }, 25);
  $("btn-tk-yes").focus();
}

// ---------- Sword ----------

function updateWeapon(): void {
  ui.weapon.hidden = !settings.flameSword;
  ui.weapon.classList.toggle("flame", settings.flameEquipped);
  ui.weaponName.textContent = settings.flameEquipped ? "🔥 Flaming Sword" : "⚔️ Sword";
}

function toggleSword(): void {
  if (!settings.flameSword) return;
  settings.flameEquipped = !settings.flameEquipped;
  saveSettings(settings);
  game.setFlameSword(settings.flameEquipped);
  updateWeapon();
  sfx.switchSword();
  toast(settings.flameEquipped ? "🔥 Flaming Sword equipped!" : "⚔️ Back to your trusty sword.");
}

// ---------- Flow ----------

/** Builds a level (if it isn't the current one) behind a loading card, then runs `then`. */
function loadLevel(id: number, then: () => void): void {
  if (game && game.level.id === id) {
    then();
    return;
  }
  ui.levelLoadingTitle.textContent = `Level ${id}: ${LEVEL_NAMES[id] ?? ""}`;
  setState("level-loading");
  show(ui.levelLoading);
  // Give the loading card a moment to paint before the level build.
  window.setTimeout(() => {
    game?.dispose();
    game = new Game(gs, events, id);
    game.setFlameSword(settings.flameSword && settings.flameEquipped);
    then();
  }, 60);
}

function enterPlaying(): void {
  show(null);
  setState("playing");
  showHint();
}

/** Starts a level from the beginning. */
function playLevel(id: number): void {
  sfx.click();
  loadLevel(id, () => {
    game.start(null);
    saveGame(game.saveData());
    enterPlaying();
  });
}

function play(fresh: boolean): void {
  if (fresh) {
    clearGame();
    playLevel(1);
    return;
  }
  const save = loadGame();
  if (!save) {
    toast("No saved adventure yet. Press Play!");
    return;
  }
  sfx.click();
  loadLevel(save.level, () => {
    game.start(save);
    enterPlaying();
  });
}

function pause(): void {
  if (state !== "playing") return;
  saveGame(game.saveData());
  setState("paused");
  show(ui.pause);
}

function resume(): void {
  sfx.click();
  show(null);
  setState("playing");
}

function openOptions(from: State): void {
  sfx.click();
  optionsReturn = from;
  setState("options");
  show(ui.options);
}

function toMenu(): void {
  sfx.click();
  if (!game.over) saveGame(game.saveData());
  show(null);
  ui.bossIntro.hidden = true;
  setState("menu");
  updateContinue();
}

const events = {
  health: renderHearts,
  boss(hp: number | null, max: number, name: string) {
    ui.bossName.textContent = name;
    ui.bossBar.hidden = hp === null;
    if (hp !== null) ui.bossFill.style.width = `${(hp / max) * 100}%`;
  },
  bossIntro(intro: BossIntro) {
    ui.introImg.src = intro.image;
    ui.introSmall.textContent = intro.subtitle;
    ui.introBig.textContent = intro.title;
    ui.bossIntro.hidden = false;
    window.setTimeout(() => (ui.bossIntro.hidden = true), 2600);
  },
  hurt() {
    ui.hurtFlash.classList.add("on");
    window.setTimeout(() => ui.hurtFlash.classList.remove("on"), 60);
  },
  toast,
  checkpoint() {
    saveGame(game.saveData());
  },
  died() {
    window.setTimeout(showTimeKeeper, 1300);
  },
  reward() {
    settings.flameSword = true;
    saveSettings(settings);
    updateWeapon();
    ui.rewardCard.hidden = false;
    window.setTimeout(() => (ui.rewardCard.hidden = true), 3800);
  },
  won() {
    const id = game.level.id;
    const hasNext = id < LEVEL_COUNT;
    if (hasNext) saveGame({ level: id + 1, checkpoint: 0, hearts: MAX_HEARTS, defeatedZombies: [], heartsTaken: [], bossesDefeated: 0 });
    else clearGame();
    ui.victoryText.textContent =
      id === 1
        ? "You defeated the Rotten Potato and saved Moonlit Hollow! Next stop: the Colosseum."
        : "You beat Sam the Bad Man, the Blood Box and Fire Rose, and won the Flaming Sword! Press F to swap swords in any level.";
    ui.nextBtn.hidden = !hasNext;
    setState("won");
    show(ui.victory);
  },
};

// ---------- Buttons ----------

$("btn-play").addEventListener("click", () => state === "menu" && play(true));
$("btn-continue").addEventListener("click", () => state === "menu" && play(false));
$("btn-options").addEventListener("click", () => state === "menu" && openOptions("menu"));
$("btn-quit").addEventListener("click", () => {
  if (state !== "menu") return;
  sfx.click();
  setState("quit");
  ui.menu.hidden = true;
  show(ui.quit);
});
$("btn-quit-back").addEventListener("click", toMenu);
$("btn-resume").addEventListener("click", resume);
$("btn-pause-options").addEventListener("click", () => openOptions("paused"));
$("btn-pause-help").addEventListener("click", () => {
  sfx.click();
  setState("help");
  show(ui.help);
});
$("btn-help-back").addEventListener("click", () => {
  sfx.click();
  setState("paused");
  show(ui.pause);
});
$("btn-mainmenu").addEventListener("click", toMenu);
$("btn-options-back").addEventListener("click", () => {
  sfx.click();
  if (optionsReturn === "paused") {
    setState("paused");
    show(ui.pause);
  } else {
    show(null);
    setState("menu");
  }
});
ui.soundBtn.addEventListener("click", () => {
  setMuted(!isMuted());
  settings.muted = isMuted();
  saveSettings(settings);
  updateSoundButton();
  sfx.click();
});
$("btn-tk-yes").addEventListener("click", () => {
  if (state !== "dead" || ui.timekeeper.classList.contains("rewinding")) return;
  // Turn back time: the clock spins backwards, then you're back at your last save.
  sfx.rewind();
  ui.timekeeper.classList.add("rewinding");
  window.setTimeout(() => {
    game.respawn();
    ui.timekeeper.classList.remove("rewinding");
    show(null);
    setState("playing");
    toast("⏳ Time turned back! Have another go!");
  }, 1600);
});
$("btn-tk-no").addEventListener("click", () => {
  if (state === "dead" && !ui.timekeeper.classList.contains("rewinding")) toMenu();
});
$("btn-again").addEventListener("click", () => playLevel(game.level.id));
ui.nextBtn.addEventListener("click", () => playLevel(game.level.id + 1));
for (let id = 1; id <= LEVEL_COUNT; id++) {
  $(`btn-level-${id}`).addEventListener("click", () => {
    if (state === "options") playLevel(id);
  });
}
$("btn-victory-menu").addEventListener("click", toMenu);

// ---------- Input ----------

const GAME_KEYS = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyJ", "KeyK", "KeyF"]);

window.addEventListener("keydown", (e) => {
  if (state === "playing") {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.code === "KeyJ" && !e.repeat) game.attack();
    if (e.code === "KeyF" && !e.repeat) toggleSword();
    if ((e.code === "Escape" || e.code === "KeyP") && !e.repeat) pause();
  } else if (state === "paused" && (e.code === "Escape" || e.code === "KeyP") && !e.repeat) {
    resume();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  keys.clear();
  mouseBlock = false;
});

// The mouse is optional: clicking the game captures it for looking around.
canvas.addEventListener("mousedown", (e) => {
  if (state !== "playing") return;
  if (document.pointerLockElement !== canvas) {
    const result = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    result?.catch?.(() => {});
    return;
  }
  if (e.button === 0) game.attack();
  if (e.button === 2) mouseBlock = true;
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 2) mouseBlock = false;
});
window.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("mousemove", (e) => {
  if (state !== "playing" || document.pointerLockElement !== canvas) return;
  if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
  game.player.look(e.movementX * MOUSE_SENSITIVITY, e.movementY * MOUSE_SENSITIVITY);
});
document.addEventListener("pointerlockchange", () => {
  // Esc while the mouse is captured releases it; treat that as pause.
  if (!document.pointerLockElement && state === "playing") pause();
});

// ---------- Main loop ----------

function resize(): void {
  gs.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize);
resize();

window.addEventListener("beforeunload", () => {
  if (game && !game.over && state !== "menu") saveGame(game.saveData());
});

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state === "playing") {
    const down = (...codes: string[]) => codes.some((c) => keys.has(c));
    const p = game.player;
    p.yaw -= ((down("ArrowRight") ? 1 : 0) - (down("ArrowLeft") ? 1 : 0)) * TURN_SPEED * dt;
    p.look(0, ((down("ArrowDown") ? 1 : 0) - (down("ArrowUp") ? 1 : 0)) * LOOK_SPEED * dt);
    game.update(dt, {
      move: {
        forward: (down("KeyW") ? 1 : 0) - (down("KeyS") ? 1 : 0),
        right: (down("KeyD") ? 1 : 0) - (down("KeyA") ? 1 : 0),
        jump: down("Space"),
        slow: false,
      },
      blocking: down("KeyK") || mouseBlock,
    });
  }

  // The menu artwork covers the whole screen, so skip drawing the world behind it.
  if (game && state !== "menu" && state !== "loading" && state !== "level-loading" && state !== "quit") {
    game.player.eye(gs.camera.position);
    gs.camera.rotation.set(game.player.pitch, game.player.yaw, 0);
    gs.update(dt);
    gs.render();
  }
  requestAnimationFrame(frame);
}

updateSoundButton();
updateContinue();
renderHearts(MAX_HEARTS);
setState("loading");
// Let the menu art paint before the (slightly slow) level build.
window.setTimeout(() => {
  game = new Game(gs, events, 1);
  game.setFlameSword(settings.flameSword && settings.flameEquipped);
  updateWeapon();
  ui.loading.hidden = true;
  setState("menu");

  // Development-only hook so the game can be driven by automated checks.
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __game: {
        get game() {
          return game;
        },
        keys,
        getState: () => state,
        playLevel,
      },
    });
  }
}, 50);
requestAnimationFrame(frame);
