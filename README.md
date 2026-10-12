# Signal Room

Signal Room is a browser codebreaking game for 2–8 players. The host creates a room and shares its six-character code. Players race to decode the same intercepted word across six 90-second rounds.

## Gameplay

- The host picks a theme when opening a room — Maritime, Signals & Secrets, Sky & Weather, Land & Landmarks, Gadgets & Machines, or Mixed. Six transmissions are then drawn from a 67-scenario collection (each theme has at least thirteen). Consecutive games of the same theme use different scenarios, so a word cannot repeat between back-to-back games.
- A clue appears every 20 seconds. Correct answers score 4, 3, 2, or 1 points based on clues revealed, plus 2 points for the first solver of each round.
- Incorrect guesses lock that player out for three seconds.
- The host advances between rounds. The final board declares a winner or shared victory.
- Solo practice uses the same scoring and round flow.

## Publish from GitHub (continuous deploy)

Netlify builds and deploys automatically on every push once the repository is connected:

1. Sign in to Netlify and choose **Add new site → Import an existing project**.
2. Pick **GitHub** and authorize access, then select this repository.
3. Netlify reads the included `netlify.toml` and pre-fills the build command (`npm run build`), publish directory (`dist`), and functions directory (`netlify/functions`). Leave them as detected.
4. Click **Deploy site**. Every push to `main` now redeploys, and each pull request gets its own deploy preview.

## Publish with Netlify Drop

For a one-off deploy without connecting the repository:

1. Sign in to Netlify and open the Drag and Drop publisher.
2. Upload `netlify-ready-game.zip` (or drop the extracted project folder).
3. Netlify reads the included `netlify.toml`, builds the static page, and packages `netlify/functions/game.ts`.
4. Open the resulting site URL and share it with players.

The game uses a standard Netlify Function and a strongly consistent Netlify Blobs store. Blobs are provisioned by Netlify, so the project needs no credentials, environment variables, API keys, or separate database setup. The browser calls `/.netlify/functions/game` directly. Room updates use conditional writes so two players cannot silently overwrite one another's scores.

## Project contents

- `index.html` and `src/game-client.js`: the game interface and browser client.
- `netlify/functions/game.ts`: the HTTP function at Netlify's default `/.netlify/functions/game` route.
- `netlify/lib/`: server-only puzzle data and game-state logic.
- `netlify.toml`, `package.json`, and `package-lock.json`: build and function configuration.
- `tests/game-flow.test.ts`: a deterministic three-round, two-player scoring and winner scenario.

The production game remains six rounds. The three-round scenario is only a faster automated check of the same scoring and winner rules.
