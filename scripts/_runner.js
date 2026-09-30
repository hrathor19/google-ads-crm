/**
 * Shared bootstrap for the CLI scripts (sync, seed helpers, parity probe).
 *
 * `server-only` is the reason for `--conditions=react-server`: outside Next it
 * resolves to the throwing client build, so the condition picks the empty one
 * and the same modules the app imports can run in a plain Node process.
 */
require('dotenv').config();
require('tsconfig-paths/register');
require('ts-node').register({
  compilerOptions: { module: 'CommonJS', moduleResolution: 'node' },
  transpileOnly: true,
});
