import { config } from 'dotenv';

// Tests read the same .env the app does — the parity suite is only meaningful
// against the real synced data.
config();
