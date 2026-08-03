import {
  ensureMusicFromGesture,
  isMusicMuted,
  setMusicMuted,
  startMusic,
  unlockAudio,
} from "../game/audio/music";
import { sfxClick, sfxLinkOk, sfxLinkStart } from "../game/audio/sfx";
import { RACES } from "../game/sim/defs";
import type { RaceId } from "../game/sim/types";
import { mountShell } from "./shell";
import { mountTitle, type TitleHandle } from "./title";
import { mountPlay, type PlayHandle } from "./play";

function randomRace(): RaceId {
  const list = Object.values(RACES);
  return list[Math.floor(Math.random() * list.length)]!.id;
}

export function startApp(root: HTMLElement) {
  const stage = mountShell(root);
  let title: TitleHandle | null = null;
  let play: PlayHandle | null = null;
  let muted = isMusicMuted();
  let linkOverlay: HTMLElement | null = null;

  const kickMusic = () => {
    unlockAudio();
    startMusic();
  };

  const clearLinkOverlay = () => {
    linkOverlay?.remove();
    linkOverlay = null;
  };

  /** CRT interstitial between faction pick and combat mesh. */
  const showEstablishingLink = (onReady: () => void) => {
    clearLinkOverlay();
    const ov = document.createElement("div");
    ov.className = "link-overlay";
    ov.innerHTML = `
      <div class="link-card">
        <p class="link-kicker">// BSA DROP CHANNEL</p>
        <p class="link-title" id="link-title">ESTABLISHING LINK</p>
        <div class="link-bar"><div class="link-bar-fill"></div></div>
        <p class="link-sub" id="link-sub">HANDSHAKE · CARRIER SYNC · MESH SEED</p>
      </div>
    `;
    stage.append(ov);
    linkOverlay = ov;
    sfxLinkStart();

    // status ticks while bar fills
    const sub = ov.querySelector("#link-sub") as HTMLElement;
    const steps = [
      "HANDSHAKE…",
      "CARRIER SYNC…",
      "MESH SEED…",
      "ORBITAL FRAME…",
      "LINK GREEN",
    ];
    steps.forEach((s, i) => {
      window.setTimeout(() => {
        if (linkOverlay !== ov) return;
        sub.textContent = s;
      }, 180 + i * 220);
    });

    window.setTimeout(() => {
      if (linkOverlay !== ov) return;
      sfxLinkOk();
      onReady();
    }, 1100);
  };

  const showTitle = () => {
    play?.dispose();
    play = null;
    clearLinkOverlay();
    title?.dispose();
    // Title should have soundtrack too (may stay silent until first gesture — autoplay policy)
    kickMusic();
    title = mountTitle(stage, {
      muted,
      getMuted: () => muted,
      onToggleMute: () => {
        ensureMusicFromGesture();
        muted = !isMusicMuted();
        setMusicMuted(muted);
        if (!muted) kickMusic();
        title?.setMuted(muted);
        sfxClick();
      },
      onEngage: () => {
        kickMusic();
        void import("../game/render/planetMath").then((m) =>
          m.warmPlanetGeometry().catch(() => {}),
        );
      },
      onCommit: (_mode, race) => {
        kickMusic();
        title?.dispose();
        title = null;
        showEstablishingLink(() => {
          play = mountPlay(
            stage,
            { localRace: race, enemyRace: randomRace() },
            {
              onExit: showTitle,
              getMuted: () => muted,
              onMutedChange: (m) => {
                muted = m;
              },
              linkOverlay: linkOverlay ?? undefined,
              onLinkDismiss: clearLinkOverlay,
            },
          );
        });
      },
    });
  };

  showTitle();

  return {
    dispose() {
      clearLinkOverlay();
      title?.dispose();
      play?.dispose();
    },
  };
}
