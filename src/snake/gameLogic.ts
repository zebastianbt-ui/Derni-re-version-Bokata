export type Direction = "up" | "down" | "left" | "right";

export type SnakeStatus = "playing" | "paused" | "game_over";

export type Position = {
  x: number;
  y: number;
};

export type SnakeGameState = {
  gridSize: number;
  snake: Position[];
  direction: Direction;
  queuedDirection: Direction;
  food: Position | null;
  score: number;
  status: SnakeStatus;
};

export const DEFAULT_GRID_SIZE = 16;

const OPPOSITE_DIRECTIONS: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

const DIRECTION_VECTORS: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const toCellKey = (position: Position) => `${position.x},${position.y}`;

export const sameCell = (a: Position, b: Position) => a.x === b.x && a.y === b.y;

export const canTurnToDirection = (current: Direction, next: Direction) =>
  OPPOSITE_DIRECTIONS[current] !== next;

const isInsideGrid = (position: Position, gridSize: number) =>
  position.x >= 0 && position.x < gridSize && position.y >= 0 && position.y < gridSize;

const moveHead = (head: Position, direction: Direction): Position => {
  const vector = DIRECTION_VECTORS[direction];
  return { x: head.x + vector.x, y: head.y + vector.y };
};

export const spawnFood = (
  snake: Position[],
  gridSize: number,
  random: () => number = Math.random
): Position | null => {
  const occupied = new Set(snake.map(toCellKey));
  const emptyCells: Position[] = [];

  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      const cell = { x, y };
      if (!occupied.has(toCellKey(cell))) {
        emptyCells.push(cell);
      }
    }
  }

  if (emptyCells.length === 0) {
    return null;
  }

  const index = Math.min(
    emptyCells.length - 1,
    Math.floor(Math.max(0, random()) * emptyCells.length)
  );

  return emptyCells[index];
};

export const createInitialGameState = (
  gridSize: number = DEFAULT_GRID_SIZE,
  random: () => number = Math.random
): SnakeGameState => {
  const center = Math.floor(gridSize / 2);
  const snake = [
    { x: center, y: center },
    { x: center - 1, y: center },
    { x: center - 2, y: center },
  ];

  return {
    gridSize,
    snake,
    direction: "right",
    queuedDirection: "right",
    food: spawnFood(snake, gridSize, random),
    score: 0,
    status: "playing",
  };
};

export const queueDirection = (state: SnakeGameState, nextDirection: Direction): SnakeGameState => {
  if (state.status === "game_over") {
    return state;
  }

  if (!canTurnToDirection(state.direction, nextDirection)) {
    return state;
  }

  return {
    ...state,
    queuedDirection: nextDirection,
  };
};

export const advanceGame = (
  state: SnakeGameState,
  random: () => number = Math.random
): SnakeGameState => {
  if (state.status !== "playing") {
    return state;
  }

  const direction = canTurnToDirection(state.direction, state.queuedDirection)
    ? state.queuedDirection
    : state.direction;
  const nextHead = moveHead(state.snake[0], direction);

  if (!isInsideGrid(nextHead, state.gridSize)) {
    return {
      ...state,
      direction,
      queuedDirection: direction,
      status: "game_over",
    };
  }

  const willEatFood = !!state.food && sameCell(nextHead, state.food);
  const bodyToCheck = willEatFood ? state.snake : state.snake.slice(0, -1);
  const hitSelf = bodyToCheck.some((segment) => sameCell(segment, nextHead));

  if (hitSelf) {
    return {
      ...state,
      direction,
      queuedDirection: direction,
      status: "game_over",
    };
  }

  const grownSnake = [nextHead, ...state.snake];

  if (willEatFood) {
    const nextFood = spawnFood(grownSnake, state.gridSize, random);
    return {
      ...state,
      snake: grownSnake,
      direction,
      queuedDirection: direction,
      food: nextFood,
      score: state.score + 1,
      status: nextFood ? "playing" : "game_over",
    };
  }

  grownSnake.pop();

  return {
    ...state,
    snake: grownSnake,
    direction,
    queuedDirection: direction,
  };
};

export const togglePause = (state: SnakeGameState): SnakeGameState => {
  if (state.status === "game_over") {
    return state;
  }

  return {
    ...state,
    status: state.status === "paused" ? "playing" : "paused",
  };
};

export const restartGame = (
  state: SnakeGameState,
  random: () => number = Math.random
): SnakeGameState => createInitialGameState(state.gridSize, random);
