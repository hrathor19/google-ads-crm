/**
 * Shared bootstrap for the CLI scripts (sync, seed helpers, parity probe,
 * e2e and responsive checks).
 *
 * `server-only` is the reason callers pass `--conditions=react-server`:
 * outside Next it resolves to the throwing client build, so the condition
 * picks the empty one and the same modules the app imports can run in a plain
 * Node process.
 *
 * The ES2022 target matters for the browser-driving scripts: at a lower
 * target, TypeScript downlevels `async` functions into `__awaiter` helpers,
 * and any such function passed into `page.evaluate` then throws
 * "__awaiter is not defined" inside the page, where those helpers do not exist.
 */
require('dotenv').config();
require('tsconfig-paths/register');
require('ts-node').register({
  compilerOptions: { module: 'CommonJS', moduleResolution: 'node', target: 'ES2022' },
  transpileOnly: true,
});
