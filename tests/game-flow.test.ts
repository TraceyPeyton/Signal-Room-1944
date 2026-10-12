import assert from "node:assert/strict";
import test from "node:test";
import { createGameHandler, type GameRoom, type RoomStore } from "../netlify/lib/game-api.js";
import { puzzles } from "../netlify/lib/puzzles.js";

class MemoryRoomStore implements RoomStore {
  private readonly entries = new Map<string, { data: unknown; etag: string }>();
  private revision = 0;

  room(code: string): GameRoom | null {
    const entry = this.entries.get(`room:${code}`);
    return entry ? structuredClone(entry.data as GameRoom) : null;
  }

  async getWithMetadata(key: string): Promise<{ data: unknown; etag?: string } | null> {
    const entry = this.entries.get(key);
    return entry ? { data: structuredClone(entry.data), etag: entry.etag } : null;
  }

  async setJSON(
    key: string,
    value: unknown,
    options: { onlyIfNew?: boolean; onlyIfMatch?: string },
  ): Promise<{ modified: boolean; etag?: string }> {
    const current = this.entries.get(key);
    if (options.onlyIfNew && current) return { modified: false };
    if (options.onlyIfMatch && current?.etag !== options.onlyIfMatch) return { modified: false };
    const etag = `test-etag-${++this.revision}`;
    this.entries.set(key, { data: structuredClone(value), etag });
    return { modified: true, etag };
  }
}

test("two players complete three rounds with clue-based scoring and a final winner", async () => {
  const store = new MemoryRoomStore();
  let clock = 1_000_000;
  let id = 0;
  let token = 0;
  let roomCode = 0;
  const handler = createGameHandler({
    store,
    roundsPerGame: 3,
    now: () => clock,
    random: () => 0,
    makeRoomCode: () => ["ABCD23", "EFGH45"][roomCode++] ?? `ROOM${roomCode}`,
    makeId: () => `player-${++id}`,
    makeToken: () => `session-${++token}`,
  });

  async function call<T = Record<string, unknown>>(
    action: string,
    credentials: { roomCode: string; playerId: string; token: string } | null = null,
    extra: Record<string, unknown> = {},
  ): Promise<T> {
    const response = await handler(new Request("http://localhost/.netlify/functions/game", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...(credentials ?? {}), ...extra }),
    }));
    const data = await response.json() as T & { error?: string };
    assert.equal(response.ok, true, data.error || `Unexpected ${response.status} response`);
    return data;
  }

  const created = await call<{ session: { roomCode: string; playerId: string; token: string }; state: { status: string } }>(
    "create", null, { name: "Morse" },
  );
  const host = created.session;
  assert.equal(created.state.status, "lobby");
  const joined = await call<{ session: { roomCode: string; playerId: string; token: string } }>(
    "join", null, { roomCode: host.roomCode, name: "Beacon" },
  );
  const guest = joined.session;

  let response = await call<{ state: GameRoom & { round: { puzzleIndex: number; clueCount: number } } }>("start", host);
  let state = response.state;
  assert.equal(state.status, "playing");
  assert.equal(state.roundCount, 3);
  const firstScenario = state.round!.puzzleIndex;

  const submitCorrect = async (player: typeof host | typeof guest) => {
    const active = await call<{ state: GameRoom & { round: { puzzleIndex: number } } }>("state", player);
    const answer = puzzles[active.state.round!.puzzleIndex].word;
    return call<{ feedback: string; state: GameRoom & { status: string; players: Array<{ id: string; score: number }> } }>(
      "guess", player, { guess: answer },
    );
  };

  let round = await submitCorrect(host);
  assert.match(round.feedback, /\+6 points/);
  assert.equal(round.state.status, "playing");
  round = await submitCorrect(guest);
  assert.match(round.feedback, /\+4 points/);
  assert.equal(round.state.status, "roundOver");

  state = (await call<{ state: GameRoom & { round: { puzzleIndex: number; clueCount: number } } }>("next", host)).state;
  clock = state.round!.startedAt + 20_000;
  state = (await call<{ state: GameRoom & { round: { puzzleIndex: number; clueCount: number } } }>("state", host)).state;
  assert.equal(state.round!.clueCount, 1);
  round = await submitCorrect(guest);
  assert.match(round.feedback, /\+5 points/);
  round = await submitCorrect(host);
  assert.match(round.feedback, /\+3 points/);
  assert.equal(round.state.status, "roundOver");

  state = (await call<{ state: GameRoom & { round: { puzzleIndex: number; clueCount: number } } }>("next", host)).state;
  clock = state.round!.startedAt + 40_000;
  state = (await call<{ state: GameRoom & { round: { puzzleIndex: number; clueCount: number } } }>("state", host)).state;
  assert.equal(state.round!.clueCount, 2);
  round = await submitCorrect(host);
  assert.match(round.feedback, /\+4 points/);
  round = await submitCorrect(guest);
  assert.match(round.feedback, /\+2 points/);
  assert.equal(round.state.status, "roundOver");

  const final = await call<{ state: { status: string; winners: string[]; players: Array<{ id: string; score: number }> } }>("next", host);
  assert.equal(final.state.status, "finished");
  assert.deepEqual(final.state.winners, [host.playerId]);
  assert.deepEqual(
    final.state.players.map((player) => [player.id, player.score]),
    [[host.playerId, 13], [guest.playerId, 11]],
  );
  const firstGameScenarios = store.room(host.roomCode)!.puzzleOrder;

  const nextHost = (await call<{ session: { roomCode: string; playerId: string; token: string } }>(
    "create", null, { name: "Next Host" },
  )).session;
  const nextGuest = (await call<{ session: { roomCode: string; playerId: string; token: string } }>(
    "join", null, { roomCode: nextHost.roomCode, name: "Next Agent" },
  )).session;
  const nextGame = await call<{ state: GameRoom & { round: { puzzleIndex: number } } }>("start", nextHost);
  assert.notEqual(nextGame.state.round!.puzzleIndex, firstScenario);
  const nextGameScenarios = store.room(nextHost.roomCode)!.puzzleOrder;
  assert.equal(firstGameScenarios.some((index) => nextGameScenarios.includes(index)), false);
  assert.equal(nextGuest.roomCode, nextHost.roomCode);
});
