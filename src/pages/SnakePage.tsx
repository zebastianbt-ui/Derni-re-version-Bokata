import React from "react";
import { Link } from "react-router-dom";
import {
  advanceGame,
  createInitialGameState,
  queueDirection,
  restartGame,
  togglePause,
  type Direction,
} from "../snake/gameLogic";

const GRID_SIZE = 16;
const TICK_MS = 140;

const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  W: "up",
  s: "down",
  S: "down",
  a: "left",
  A: "left",
  d: "right",
  D: "right",
};

const BUTTON_STYLE =
  "h-11 w-11 rounded-lg border border-pink-200/40 bg-white/10 text-white text-lg font-semibold hover:bg-white/20 active:scale-95";

export default function SnakePage() {
  const [game, setGame] = React.useState(() => createInitialGameState(GRID_SIZE));

  React.useEffect(() => {
    if (game.status !== "playing") {
      return;
    }

    const intervalId = window.setInterval(() => {
      setGame((current) => advanceGame(current));
    }, TICK_MS);

    return () => window.clearInterval(intervalId);
  }, [game.status]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = KEY_TO_DIRECTION[event.key];
      if (direction) {
        event.preventDefault();
        setGame((current) => queueDirection(current, direction));
        return;
      }

      if (event.key === " ") {
        event.preventDefault();
        setGame((current) => togglePause(current));
        return;
      }

      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        setGame((current) => restartGame(current));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const snakeCells = React.useMemo(
    () => new Set(game.snake.map((segment) => `${segment.x},${segment.y}`)),
    [game.snake]
  );

  const isGameOver = game.status === "game_over";
  const isPaused = game.status === "paused";

  const statusLabel = isGameOver ? "Game over" : isPaused ? "Paused" : "Playing";

  const renderCell = (x: number, y: number) => {
    const key = `${x},${y}`;
    const isSnake = snakeCells.has(key);
    const isHead = game.snake[0]?.x === x && game.snake[0]?.y === y;
    const isFood = game.food?.x === x && game.food?.y === y;

    let className = "rounded-[2px] bg-white/5";
    if (isFood) className = "rounded-[2px] bg-pink-500";
    if (isSnake) className = isHead ? "rounded-[2px] bg-emerald-300" : "rounded-[2px] bg-emerald-500";

    return <div key={key} className={className} />;
  };

  const queueFromButton = (direction: Direction) => {
    setGame((current) => queueDirection(current, direction));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#3d015f] via-[#2a0044] to-pink-600 px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center rounded-full border border-pink-200/40 px-4 py-2 text-sm hover:bg-white/10"
          >
            ← Back
          </Link>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-pink-100">Score</p>
            <p className="text-2xl font-bold">{game.score}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-pink-200/30 bg-white/10 p-4 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-2xl font-bold">Snake</h1>
            <span className="rounded-full border border-pink-200/40 px-3 py-1 text-sm">{statusLabel}</span>
          </div>
          <p className="mb-4 text-sm text-pink-100">Use arrow keys or WASD. Press space to pause and R to restart.</p>

          <div className="mx-auto aspect-square w-full max-w-[520px] rounded-lg border border-pink-200/40 bg-[#120022] p-2">
            <div
              className="grid h-full w-full gap-[2px]"
              style={{ gridTemplateColumns: `repeat(${game.gridSize}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: game.gridSize * game.gridSize }, (_, index) => {
                const x = index % game.gridSize;
                const y = Math.floor(index / game.gridSize);
                return renderCell(x, y);
              })}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setGame((current) => togglePause(current))}
              className="rounded-full border border-pink-200/40 px-4 py-2 text-sm font-semibold hover:bg-white/10"
            >
              {isPaused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={() => setGame((current) => restartGame(current))}
              className="rounded-full bg-pink-600 px-4 py-2 text-sm font-semibold hover:bg-pink-700"
            >
              Restart
            </button>
          </div>

          <div className="mx-auto mt-6 grid w-[170px] grid-cols-3 gap-2">
            <div />
            <button type="button" className={BUTTON_STYLE} onClick={() => queueFromButton("up")} aria-label="Move up">
              ↑
            </button>
            <div />
            <button
              type="button"
              className={BUTTON_STYLE}
              onClick={() => queueFromButton("left")}
              aria-label="Move left"
            >
              ←
            </button>
            <button
              type="button"
              className={BUTTON_STYLE}
              onClick={() => setGame((current) => togglePause(current))}
              aria-label={isPaused ? "Resume game" : "Pause game"}
            >
              {isPaused ? "▶" : "⏸"}
            </button>
            <button
              type="button"
              className={BUTTON_STYLE}
              onClick={() => queueFromButton("right")}
              aria-label="Move right"
            >
              →
            </button>
            <div />
            <button
              type="button"
              className={BUTTON_STYLE}
              onClick={() => queueFromButton("down")}
              aria-label="Move down"
            >
              ↓
            </button>
            <div />
          </div>

          {isGameOver && (
            <p className="mt-4 rounded-lg border border-pink-200/30 bg-pink-900/30 px-3 py-2 text-center text-sm text-pink-100">
              You lost. Press Restart or tap R to play again.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
