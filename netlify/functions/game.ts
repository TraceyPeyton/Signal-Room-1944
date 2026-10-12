import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { createGameHandler, type RoomStore } from "../lib/game-api.js";

export default async function game(request: Request, _context: Context): Promise<Response> {
  const store = getStore({ name: "signal-room-games", consistency: "strong" }) as unknown as RoomStore;
  return createGameHandler({ store })(request);
}
