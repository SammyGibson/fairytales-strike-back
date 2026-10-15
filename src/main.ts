import "./style.css";
import { Game, MAX_HEARTS } from "./game";
import { clearGame, loadGame, loadSettings, saveGame, saveSettings } from "./save";
import { GameScene } from "./scene";
import { isMuted, setMuted, sfx } from "./sound";
import { buildAtlas } from "./textures";

const TURN_SPEED = 2.6;
const LOOK_SPEED = 1.6;
const MOUSE_SENSITIVITY = 0.0022;

type State = "loading" | "menu" | "playing" | "paused" | "options" | "help" | "dead" | "won" | "quit";

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
  gameover: $("gameover"),
  victory: $("victory"),
  quit: $("quit"),
  soundBtn: $("btn-sound"),
};
const overlays = [ui.pause, ui.options, ui.help, ui.gameover, ui.victory, ui.quit];

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

// ---------- Flow ----------

function play(fresh: boolean): void {
  sfx.click();
  if (fresh) {
    clearGame();
    game.start(null);
  } else {
    const save = loadGame();
    if (!save) {
      toast("No saved adventure yet. Press Play!");
      return;
    }
    game.start(save);
  }
  show(null);
  setState("playing");
  showHint();
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
  boss(hp: number | null, max: number) {
    ui.bossBar.hidden = hp === null;
    if (hp !== null) ui.bossFill.style.width = `${(hp / max) * 100}%`;
  },
  bossIntro() {
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
    window.setTimeout(() => {
      setState("dead");
      show(ui.gameover);
    }, 1300);
  },
  won() {
    clearGame();
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
$("btn-retry").addEventListener("click", () => {
  sfx.click();
  game.respawn();
  show(null);
  setState("playing");
});
$("btn-gameover-menu").addEventListener("click", toMenu);
$("btn-again").addEventListener("click", () => play(true));
$("btn-victory-menu").addEventListener("click", toMenu);

// ---------- Input ----------

const GAME_KEYS = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyJ", "KeyK"]);

window.addEventListener("keydown", (e) => {
  if (state === "playing") {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.code === "KeyJ" && !e.repeat) game.attack();
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
  if (game && state !== "menu" && state !== "loading" && state !== "quit") {
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
  game = new Game(gs, events);
  ui.loading.hidden = true;
  setState("menu");

  // Development-only hook so the game can be driven by automated checks.
  if (import.meta.env.DEV) Object.assign(window, { __game: { game, keys, getState: () => state } });
}, 50);
requestAnimationFrame(frame);
