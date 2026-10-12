import { randomBytes } from "node:crypto";
import { puzzles, type Puzzle } from "./puzzles.js";

type Player = {
  id: string;
  name: string;
  token: string;
  score: number;
  connected: boolean;
  solved: boolean;
  lockUntil: number;
};

type ActiveRound = {
  puzzleIndex: number;
  startedAt: number;
  deadline: number;
  clueCount: number;
  firstSolvePlayerId: string | null;
  firstSolveName: string | null;
};

export type GameRoom = {
  code: string;
  hostPlayerId: string;
  practice: boolean;
  status: "lobby" | "playing" | "roundOver" | "finished" | "closed";
  roundIndex: number;
  roundCount: number;
  puzzleOrder: number[];
  round: ActiveRound | null;
  players: Player[];
  activity: string[];
  answer: string | null;
  expiresAt: number;
};

export type BlobEntry = { data: unknown; etag?: string };
export interface RoomStore {
  getWithMetadata(
    key: string,
    options: { consistency: "strong"; type: "json" },
  ): Promise<BlobEntry | null>;
  getMetadata?(
    key: string,
    options: { consistency: "strong" },
  ): Promise<{ etag?: string } | null>;
  setJSON(
    key: string,
    value: unknown,
    options: { onlyIfNew?: boolean; onlyIfMatch?: string },
  ): Promise<{ modified: boolean; etag?: string }>;
}

type GameApiOptions = {
  store: RoomStore;
  now?: () => number;
  random?: () => number;
  makeRoomCode?: () => string;
  makeId?: () => string;
  makeToken?: () => string;
  puzzleBank?: Puzzle[];
  roundsPerGame?: number;
};

type RequestBody = {
  action?: string;
  roomCode?: string;
  playerId?: string;
  token?: string;
  name?: string;
  guess?: string;
  practice?: boolean;
};

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const ROUND_MS = 90 * 1000;
const CLUE_INTERVAL_MS = 20 * 1000;
const MAX_WRITE_ATTEMPTS = 8;

function defaultRoomCode(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("");
}

function defaultId(): string {
  return randomBytes(9).toString("hex");
}

function defaultToken(): string {
  return randomBytes(32).toString("hex");
}

function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ").slice(0, 18);
  return name || fallback;
}

function normalizeCode(value: unknown): string {
  return typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) : "";
}

function normalizeGuess(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z]/g, "")
    : "";
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function keyFor(code: string): string {
  return `room:${code}`;
}

function addActivity(room: GameRoom, message: string): void {
  room.activity.unshift(message);
  room.activity = room.activity.slice(0, 8);
}

function activePlayers(room: GameRoom): Player[] {
  return room.players.filter((player) => player.connected);
}

function puzzleFor(room: GameRoom, bank: Puzzle[]): Puzzle | null {
  if (!room.round) return null;
  return bank[room.round.puzzleIndex] ?? null;
}

function finishRound(room: GameRoom, message: string, bank: Puzzle[]): void {
  if (room.status !== "playing" || !room.round) return;
  room.status = "roundOver";
  room.answer = puzzleFor(room, bank)?.word ?? null;
  addActivity(room, message);
}

function advanceRoundState(room: GameRoom, now: number, bank: Puzzle[]): void {
  if (room.status !== "playing" || !room.round) return;
  const nextClueCount = Math.min(3, Math.floor((now - room.round.startedAt) / CLUE_INTERVAL_MS));
  if (nextClueCount > room.round.clueCount) room.round.clueCount = nextClueCount;
  if (now >= room.round.deadline) {
    finishRound(room, "Time is up.", bank);
    return;
  }
  const players = activePlayers(room);
  if (players.length > 0 && players.every((player) => player.solved)) {
    finishRound(room, "Every active agent solved it.", bank);
  }
}

function shufflePuzzleOrder(length: number, count: number, random: () => number): number[] {
  const order = Array.from({ length }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(0, count);
}

async function reservePuzzleOrder(
  store: RoomStore,
  length: number,
  count: number,
  random: () => number,
): Promise<number[]> {
  const key = "meta:scenario-sequence";
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const previous = await store.getWithMetadata(key, { consistency: "strong", type: "json" });
    const shuffled = shufflePuzzleOrder(length, length, random);
    const previousSelection = previous?.data && typeof previous.data === "object"
      ? (previous.data as { previousPuzzleIndices?: unknown }).previousPuzzleIndices
      : undefined;
    const lastFirstIndex = previous?.data && typeof previous.data === "object"
      ? (previous.data as { lastFirstIndex?: unknown }).lastFirstIndex
      : undefined;
    const excluded = new Set(Array.isArray(previousSelection)
      ? previousSelection.filter((index): index is number => Number.isInteger(index) && index >= 0 && index < length)
      : []);
    if (typeof lastFirstIndex === "number" && Number.isInteger(lastFirstIndex) && lastFirstIndex >= 0 && lastFirstIndex < length) {
      excluded.add(lastFirstIndex);
    }
    const order = shuffled.filter((index) => !excluded.has(index)).slice(0, count);
    for (const index of shuffled) {
      if (order.length >= count) break;
      if (!order.includes(index)) order.push(index);
    }
    if (order.length > 1 && order[0] === lastFirstIndex) [order[0], order[1]] = [order[1], order[0]];

    const next = { lastFirstIndex: order[0], previousPuzzleIndices: order };
    if (!previous) {
      const saved = await store.setJSON(key, next, { onlyIfNew: true });
      if (saved.modified) return order;
      continue;
    }

    const etag = previous.etag ?? (await store.getMetadata?.(key, { consistency: "strong" }))?.etag;
    if (!etag) throw new ApiError(500, "Could not safely choose a new scenario. Please try again.");
    const saved = await store.setJSON(key, next, { onlyIfMatch: etag });
    if (saved.modified) return order;
  }
  throw new ApiError(409, "Scenarios are being selected at the same time. Please try again.");
}

function publicState(room: GameRoom, bank: Puzzle[]): Record<string, unknown> {
  const round = room.round && puzzleFor(room, bank)
    ? {
        index: room.roundIndex + 1,
        count: room.roundCount,
        puzzleIndex: room.round.puzzleIndex,
        cipher: puzzleFor(room, bank)!.cipher,
        note: puzzleFor(room, bank)!.note,
        clues: puzzleFor(room, bank)!.clues.slice(0, room.round.clueCount),
        clueCount: room.round.clueCount,
        startedAt: room.round.startedAt,
        deadline: room.round.deadline,
        firstSolveName: room.round.firstSolveName,
        answer: room.status === "roundOver" ? room.answer : null,
      }
    : null;
  const highScore = Math.max(0, ...room.players.map((player) => player.score));
  const winners = room.status === "finished"
    ? room.players.filter((player) => player.score === highScore).map((player) => player.id)
    : [];
  return {
    roomCode: room.code,
    hostPlayerId: room.hostPlayerId,
    practice: room.practice,
    status: room.status,
    roundIndex: room.roundIndex,
    roundCount: room.roundCount,
    round,
    players: room.players.map(({ id, name, score, connected, solved }) => ({ id, name, score, connected, solved })),
    activity: room.activity,
    winners,
  };
}

function startRound(room: GameRoom, now: number): void {
  const puzzleIndex = room.puzzleOrder[room.roundIndex];
  room.status = "playing";
  room.round = {
    puzzleIndex,
    startedAt: now,
    deadline: now + ROUND_MS,
    clueCount: 0,
    firstSolvePlayerId: null,
    firstSolveName: null,
  };
  room.answer = null;
  room.players.forEach((player) => {
    player.solved = false;
    player.lockUntil = 0;
  });
}

export function createGameHandler(options: GameApiOptions) {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const makeRoomCode = options.makeRoomCode ?? defaultRoomCode;
  const makeId = options.makeId ?? defaultId;
  const makeToken = options.makeToken ?? defaultToken;
  const bank = options.puzzleBank ?? puzzles;
  const roundsPerGame = options.roundsPerGame ?? 6;

  async function readRoom(code: string): Promise<{ room: GameRoom; etag?: string } | null> {
    const entry = await options.store.getWithMetadata(keyFor(code), { consistency: "strong", type: "json" });
    if (!entry) return null;
    return { room: entry.data as GameRoom, etag: entry.etag };
  }

  async function changeRoom<T>(
    code: string,
    change: (room: GameRoom) => T | Promise<T>,
  ): Promise<{ room: GameRoom; result: T }> {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const entry = await readRoom(code);
      if (!entry) throw new ApiError(404, "That room code is not active. Check the code with the host.");
      const room = structuredClone(entry.room);
      const before = JSON.stringify(room);
      const result = await change(room);
      if (JSON.stringify(room) === before) return { room, result };
      const etag = entry.etag ?? (await options.store.getMetadata?.(keyFor(code), { consistency: "strong" }))?.etag;
      if (!etag) throw new ApiError(500, "The room could not be updated safely. Please try again.");
      const saved = await options.store.setJSON(keyFor(code), room, { onlyIfMatch: etag });
      if (saved.modified) return { room, result };
    }
    throw new ApiError(409, "The room changed at the same time. Please try again.");
  }

  function findPlayer(room: GameRoom, body: RequestBody, allowDisconnected = false): Player {
    const player = room.players.find((candidate) => candidate.id === body.playerId && candidate.token === body.token);
    if (!player || (!allowDisconnected && !player.connected)) throw new ApiError(403, "This session is no longer active. Return to the main menu and rejoin.");
    return player;
  }

  async function createRoom(body: RequestBody): Promise<Response> {
    if (bank.length < roundsPerGame || roundsPerGame < 1) throw new ApiError(500, "The game puzzle set is not configured correctly.");
    const timestamp = now();
    const puzzleOrder = await reservePuzzleOrder(options.store, bank.length, roundsPerGame, random);
    const player: Player = {
      id: makeId(),
      name: cleanName(body.name, body.practice ? "Agent" : "Host"),
      token: makeToken(),
      score: 0,
      connected: true,
      solved: false,
      lockUntil: 0,
    };
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = makeRoomCode();
      const room: GameRoom = {
        code,
        hostPlayerId: player.id,
        practice: body.practice === true,
        status: "lobby",
        roundIndex: 0,
        roundCount: roundsPerGame,
        puzzleOrder,
        round: null,
        players: [player],
        activity: [],
        answer: null,
        expiresAt: timestamp + ROOM_TTL_MS,
      };
      const saved = await options.store.setJSON(keyFor(code), room, { onlyIfNew: true });
      if (!saved.modified) continue;
      return json({ session: { roomCode: code, playerId: player.id, token: player.token }, state: publicState(room, bank) }, 201);
    }
    throw new ApiError(503, "Could not open a new room. Please try again.");
  }

  async function joinRoom(body: RequestBody): Promise<Response> {
    const code = normalizeCode(body.roomCode);
    if (code.length !== 6) throw new ApiError(400, "Enter the six-character room code.");
    const playerId = makeId();
    const token = makeToken();
    const { room } = await changeRoom(code, (current) => {
      if (current.expiresAt <= now() || current.status === "closed") throw new ApiError(410, "That room is no longer active.");
      if (current.practice) throw new ApiError(403, "Solo practice rooms cannot be joined.");
      if (current.status !== "lobby") throw new ApiError(409, "This game has already started.");
      if (activePlayers(current).length >= 8) throw new ApiError(409, "This room is full (8 players maximum).");
      current.players.push({
        id: playerId,
        name: cleanName(body.name, "Agent"),
        token,
        score: 0,
        connected: true,
        solved: false,
        lockUntil: 0,
      });
      addActivity(current, `${cleanName(body.name, "Agent")} joined the room`);
    });
    return json({ session: { roomCode: code, playerId, token }, state: publicState(room, bank) }, 201);
  }

  async function dispatch(body: RequestBody): Promise<Response> {
    const action = body.action;
    if (action === "create") return createRoom(body);
    if (action === "join") return joinRoom(body);
    const code = normalizeCode(body.roomCode);
    if (code.length !== 6) throw new ApiError(400, "Enter a valid room code.");

    if (action === "state") {
      const { room } = await changeRoom(code, (current) => {
        findPlayer(current, body, true);
        if (current.expiresAt <= now() && current.status !== "closed") {
          current.status = "closed";
          addActivity(current, "This room expired.");
          return;
        }
        advanceRoundState(current, now(), bank);
      });
      return json({ state: publicState(room, bank) });
    }

    if (action === "start") {
      const { room } = await changeRoom(code, (current) => {
        const player = findPlayer(current, body);
        if (player.id !== current.hostPlayerId) throw new ApiError(403, "Only the host can start the game.");
        if (current.status !== "lobby") throw new ApiError(409, "This game has already started.");
        if (!current.practice && activePlayers(current).length < 2) throw new ApiError(409, "At least two players are needed to begin.");
        if (current.puzzleOrder.length < current.roundCount) {
          current.puzzleOrder = shufflePuzzleOrder(bank.length, current.roundCount, random);
        }
        current.roundIndex = 0;
        startRound(current, now());
      });
      return json({ state: publicState(room, bank) });
    }

    if (action === "guess") {
      let feedback = "";
      const { room } = await changeRoom(code, (current) => {
        const player = findPlayer(current, body);
        advanceRoundState(current, now(), bank);
        if (current.status !== "playing" || !current.round) {
          feedback = "This transmission has ended.";
          return;
        }
        if (player.solved) {
          feedback = "You already decoded this transmission.";
          return;
        }
        const timestamp = now();
        if (timestamp < player.lockUntil) {
          feedback = `Wait ${Math.ceil((player.lockUntil - timestamp) / 1000)}s before trying again.`;
          return;
        }
        const guess = normalizeGuess(body.guess);
        if (!guess) {
          feedback = "Enter a word guess first.";
          return;
        }
        const puzzle = puzzleFor(current, bank);
        if (guess !== puzzle?.word) {
          player.lockUntil = timestamp + 3000;
          feedback = "Incorrect intercept. Pause 3 seconds, then try again.";
          return;
        }
        player.solved = true;
        const points = Math.max(1, 4 - current.round.clueCount) + (current.round.firstSolvePlayerId ? 0 : 2);
        if (!current.round.firstSolvePlayerId) {
          current.round.firstSolvePlayerId = player.id;
          current.round.firstSolveName = player.name;
        }
        player.score += points;
        addActivity(current, `${player.name} decoded it · +${points} points`);
        feedback = `Decoded! +${points} points.`;
        advanceRoundState(current, timestamp, bank);
      });
      return json({ feedback, state: publicState(room, bank) });
    }

    if (action === "next") {
      const { room } = await changeRoom(code, (current) => {
        const player = findPlayer(current, body);
        if (player.id !== current.hostPlayerId) throw new ApiError(403, "Only the host can continue.");
        if (current.status !== "roundOver") throw new ApiError(409, "This transmission is still in progress.");
        if (current.roundIndex >= current.roundCount - 1) {
          current.status = "finished";
          return;
        }
        current.roundIndex += 1;
        startRound(current, now());
      });
      return json({ state: publicState(room, bank) });
    }

    if (action === "leave") {
      const { room } = await changeRoom(code, (current) => {
        const player = findPlayer(current, body, true);
        if (!player.connected) return;
        player.connected = false;
        player.solved = false;
        if (player.id === current.hostPlayerId) {
          current.status = "closed";
          addActivity(current, "The host returned to the main menu.");
        } else {
          addActivity(current, `${player.name} left the room`);
          advanceRoundState(current, now(), bank);
        }
      });
      return json({ state: publicState(room, bank) });
    }

    throw new ApiError(400, "Unknown game action.");
  }

  return async function handleGameRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") return json({ error: "Use POST for game actions." }, 405);
    let body: RequestBody;
    try {
      body = await request.json() as RequestBody;
    } catch {
      return json({ error: "Send a valid JSON request." }, 400);
    }
    try {
      return await dispatch(body);
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      return json({ error: "The room service had a problem. Please try again." }, 500);
    }
  };
}
