// Config + tiny arg parser. No dependencies beyond node:fs.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

export const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

export function loadEnv() {
  for (const f of ['.env', '.env.botkey']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    } else {
      out._.push(a);
    }
  }
  return out;
}

export const NET = {
  chainId: 50383,
  rpcUrl: process.env.RPC_URL || 'https://api.hideki2.infra.testnet.somnia.network',
  indexerUrl: process.env.INDEXER_URL || 'https://hideki-dev.smk.somnia.host/v1/graphql',
  marginBank: '0x478769E1177C0773c43A593DCCc4Ad15F15F1394',
};

export const ORDER_TYPE = { LIMIT: 0, FILL_OR_KILL: 1, MARKET: 2, POST_ONLY: 3 };

export function fmt(raw, decimals) {
  if (raw === undefined || raw === null) return '-';
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + whole.toString() + (frac ? '.' + frac : '');
}

export function alignDown(value, step) {
  if (step <= 0n) return value;
  return (value / step) * step;
}

export function pct(a, b) {
  if (b === 0n) return 'n/a';
  return (Number((a * 10000n) / b) / 100).toFixed(2) + '%';
}
