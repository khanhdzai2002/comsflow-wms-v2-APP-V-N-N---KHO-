import { useEffect, useRef, useState } from "react";

type Sound = "success" | "duplicate" | "error";
const preference = "wms-return-sound";
const tones: Record<Sound, { type: OscillatorType; notes: number[][] }> = {
  success: {
    type: "sine",
    notes: [
      [880, 0, 0.1],
      [1320, 0.13, 0.14],
    ],
  },
  duplicate: {
    type: "triangle",
    notes: [
      [660, 0, 0.07],
      [660, 0.12, 0.07],
      [660, 0.24, 0.07],
    ],
  },
  error: {
    type: "square",
    notes: [
      [220, 0, 0.17],
      [165, 0.21, 0.22],
    ],
  },
};

// Reuse one context per station. Audio is optional feedback; its failures must
// never change a committed receipt, the retry key, or the displayed outcome.
function createPlayer() {
  let context: AudioContext | null = null;
  let generation = 0;
  let closed = false;
  const playing = new Set<OscillatorNode>();
  function getContext() {
    if (closed) return null;
    if (!context || context.state === "closed") {
      const Audio =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Audio) return null;
      context = new Audio();
    }
    return context;
  }
  function stop() {
    generation++;
    for (const node of playing) {
      try {
        node.stop();
      } catch {
        /* It may already have ended. */
      }
    }
    playing.clear();
  }
  return {
    // Called during a click/key gesture, before awaiting the server, so mobile
    // autoplay restrictions do not prevent the later result from sounding.
    prepare() {
      try {
        const audio = getContext();
        if (audio && audio.state !== "running")
          void audio.resume().catch(() => {});
      } catch {
        /* Visual feedback remains available without Web Audio. */
      }
    },
    async play(sound: Sound) {
      stop();
      const current = generation;
      try {
        const audio = getContext();
        if (!audio) return;
        if (audio.state !== "running") await audio.resume();
        if (closed || current !== generation || audio.state !== "running")
          return;
        const start = audio.currentTime + 0.005;
        for (const [frequency, offset, duration] of tones[sound].notes) {
          const oscillator = audio.createOscillator(),
            gain = audio.createGain();
          oscillator.type = tones[sound].type;
          oscillator.frequency.value = frequency;
          oscillator.connect(gain);
          gain.connect(audio.destination);
          gain.gain.setValueAtTime(0.0001, start + offset);
          gain.gain.exponentialRampToValueAtTime(0.1, start + offset + 0.008);
          gain.gain.setValueAtTime(0.1, start + offset + duration - 0.02);
          gain.gain.exponentialRampToValueAtTime(
            0.0001,
            start + offset + duration,
          );
          playing.add(oscillator);
          oscillator.onended = () => {
            playing.delete(oscillator);
            oscillator.disconnect();
            gain.disconnect();
          };
          oscillator.start(start + offset);
          oscillator.stop(start + offset + duration);
        }
      } catch {
        stop();
      }
    },
    close() {
      closed = true;
      stop();
      if (context && context.state !== "closed")
        void context.close().catch(() => {});
    },
    stop,
  };
}

export function useReturnScanSound() {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(preference) !== "false";
    } catch {
      return true;
    }
  });
  const player = useRef<ReturnType<typeof createPlayer> | null>(null);
  const getPlayer = () => (player.current ??= createPlayer());
  useEffect(
    () => () => {
      player.current?.close();
      player.current = null;
    },
    [],
  );
  return {
    enabled,
    setEnabled(value: boolean) {
      setEnabled(value);
      try {
        localStorage.setItem(preference, String(value));
      } catch {
        /* Keep the session preference. */
      }
      if (value) getPlayer().prepare();
      else player.current?.stop();
    },
    prepare() {
      if (enabled) getPlayer().prepare();
    },
    play(sound: Sound) {
      if (enabled) void getPlayer().play(sound);
    },
  };
}
