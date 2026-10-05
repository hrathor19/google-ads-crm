/**
 * Run the dev server so other devices on the Wi-Fi can reach it.
 *
 *   npm run dev:lan
 *
 * Two things have to line up, and the second is the one that bites.
 *
 * `next dev` binds to localhost only, so nothing else on the network can
 * connect — that part is just `-H 0.0.0.0`.
 *
 * NextAuth builds its callback URLs from `NEXTAUTH_URL`. Left at
 * `http://localhost:3000`, a phone signing in gets redirected to its own
 * localhost mid-flow and the session never lands — which looks like a
 * broken login rather than a misconfigured URL. So this reads the machine's
 * current LAN address and sets `NEXTAUTH_URL` to match, rather than hard
 * coding an address that changes with the network.
 *
 * `PUBLIC_BASE_URL` follows it too, so the "Open the request" button in a
 * notification points somewhere a colleague can actually click.
 */
const { spawn } = require('node:child_process');
const os = require('node:os');

const PORT = process.env.PORT || '3000';

/** The first non-internal IPv4 address — the one other devices can route to. */
function lanAddress() {
  const preferred = ['en0', 'en1', 'eth0', 'wlan0'];
  const found = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) found.push({ name, address: a.address });
    }
  }
  if (found.length === 0) return null;
  // A VPN or Docker bridge can also answer here, and picking one of those
  // hands out an address nobody else can reach.
  for (const name of preferred) {
    const hit = found.find((f) => f.name === name);
    if (hit) return hit;
  }
  return found[0];
}

const lan = lanAddress();
if (!lan) {
  console.error('No network address found — are you connected to Wi-Fi?');
  process.exit(1);
}

const url = `http://${lan.address}:${PORT}`;
console.log(`\n  Ads CRM on the local network\n`);
console.log(`  This machine   http://localhost:${PORT}`);
console.log(`  Other devices  ${url}   (interface ${lan.name})\n`);
console.log('  Sign in with email and password. "Continue with Google" works only');
console.log('  on localhost: Google refuses a private IP as a redirect URI.\n');

spawn('npx', ['next', 'dev', '-H', '0.0.0.0', '-p', PORT], {
  stdio: 'inherit',
  env: { ...process.env, NEXTAUTH_URL: url, PUBLIC_BASE_URL: url },
}).on('exit', (code) => process.exit(code ?? 0));
