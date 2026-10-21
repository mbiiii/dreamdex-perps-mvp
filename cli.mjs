#!/usr/bin/env node
import { loadEnv, parseArgs } from './src/config.mjs';
import { cmdStatus } from './src/status.mjs';
import { cmdGate } from './src/gate.mjs';
import { cmdGuard } from './src/guard.mjs';
import { cmdOpen, cmdFund } from './src/open.mjs';

loadEnv();
const argv = process.argv.slice(2);
const cmd = argv[0];
const args = parseArgs(argv.slice(1));

const usage = `perps-guardian <command>

  status   --account 0x...                 account health, marked positions, funding APR
  gate     --market BTC --side long --notional 1000 [--account 0x...]
                                           the real per-account size cap before you place
  open     --market BTC --side long --notional 250 [--type limit|fok|market|post] [--live]
                                           place a real order; gate runs first, dry-run unless --live
  fund     --market BTC [--amount 1000] [--live]
                                           claim the paper USDso voucher and deposit it as margin
  guard    --account 0x... [--min-ratio 1.5] [--fraction 0.5] [--live] [--once]
                                           auto-deleverage loop (dry-run unless --live)

env (mvp-bot/.env.botkey): BOT_PRIVATE_KEY, BOT_ADDRESS, optional RPC_URL / INDEXER_URL`;

try {
  if (cmd === 'status') await cmdStatus(args);
  else if (cmd === 'gate') await cmdGate(args);
  else if (cmd === 'open') await cmdOpen(args);
  else if (cmd === 'fund') await cmdFund(args);
  else if (cmd === 'guard') await cmdGuard(args);
  else {
    console.log(usage);
    process.exit(1);
  }
  // The SDK keeps a WebSocket transport open for its lifetime; exit explicitly so a
  // one-shot command does not hang the shell. `guard` without --once never returns.
  process.exit(0);
} catch (e) {
  console.error('error:', e.name || 'Error', '|', e.message);
  process.exit(1);
}
