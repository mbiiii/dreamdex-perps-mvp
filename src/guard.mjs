import { NET, fmt, alignDown, ORDER_TYPE } from './config.mjs';
import { makeMarkets } from './markets.mjs';

// Auto-deleverage guard: when equity / maintenance requirement falls under the
// threshold, shed part of the largest position with an IOC close so the account
// does not reach the liquidation engine. Dry-run by default; --live sends.
export async function cmdGuard(args) {
  const account = String(args.account || process.env.BOT_ADDRESS || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(account)) throw new Error('need --account 0x...');
  const minRatio = Number(args['min-ratio'] || 1.5);
  const reduceFraction = Number(args.fraction || 0.5);
  const slippageBps = BigInt(args['slippage-bps'] || 50);
  const live = args.live === true;
  const once = args.once === true;
  const intervalSec = Number(args.interval || 30);

  const markets = makeMarkets(live ? { privateKey: process.env.BOT_PRIVATE_KEY } : {});
  if (live && !process.env.BOT_PRIVATE_KEY) throw new Error('--live needs BOT_PRIVATE_KEY in mvp-bot/.env.botkey');
  if (live && !markets.trader) throw new Error('no trader on this client; check the SDK version');

  const all = await markets.client.listPerpMarkets();
  const byPool = new Map(all.map((m) => [m.poolAddress.toLowerCase(), m]));

  async function tick() {
    const health = await markets.client.getAccountHealth(NET.marginBank, account);
    const ratio = health.mmReq === 0n ? Infinity : Number(health.equity * 10000n / health.mmReq) / 10000;
    const stamp = new Date().toISOString().slice(11, 19);
    if (!isFinite(ratio)) {
      console.log(stamp, 'flat: equity', fmt(health.equity, 18), 'no maintenance requirement, nothing to guard');
      return;
    }
    console.log(stamp, 'equity', fmt(health.equity, 18), 'MM', fmt(health.mmReq, 18), 'ratio', ratio.toFixed(3),
      ratio < minRatio ? '<-- below threshold, acting' : 'ok');
    if (ratio >= minRatio) return;

    const positions = await markets.client.listPerpPositions(account, { limit: 100 });
    if (!positions.length) {
      console.log('  no positions indexed yet; refusing to act on an empty read');
      return;
    }
    // largest notional first
    const enriched = [];
    for (const p of positions) {
      const m = byPool.get(p.pool.toLowerCase());
      const st = await markets.client.getPerpState(p.pool);
      const dec = m ? m.baseDecimals : 18;
      const size = BigInt(p.size);
      enriched.push({ p, m, st, size, dec, notional: (size < 0n ? -size : size) * st.markPrice / 10n ** BigInt(dec) });
    }
    enriched.sort((a, b) => (b.notional > a.notional ? 1 : b.notional < a.notional ? -1 : 0));
    const t = enriched[0];
    const abs = t.size < 0n ? -t.size : t.size;
    const qty = await markets.client.getMaxPerpOrderSize({
      pool: t.p.pool, marginBank: NET.marginBank, account, isBid: t.size < 0n, price: t.st.markPrice,
    }).catch(() => null);
    const lot = qty ? qty.lotSize : 1n;
    const minQ = qty ? qty.minQuantity : 1n;
    let orderQty = alignDown((abs * BigInt(Math.round(reduceFraction * 10000))) / 10000n, lot);
    if (orderQty < minQ) orderQty = minQ;
    if (orderQty > abs) orderQty = alignDown(abs, lot) || abs;

    const isBid = t.size < 0n; // closing a short = buy
    const price = isBid
      ? (t.st.markPrice * (10000n + slippageBps)) / 10000n
      : (t.st.markPrice * (10000n - slippageBps)) / 10000n;
    console.log('  plan: close', fmt(orderQty, t.dec), t.m.baseSymbol, isBid ? '(buy back short)' : '(sell long)',
      'IOC at', fmt(price, 18), 'slippage', slippageBps.toString(), 'bps');

    if (!live) {
      console.log('  dry-run: pass --live with a funded linked bot key to send');
      return;
    }
    try {
      const res = await markets.trader.placePerpOrder({
        pool: t.p.pool, isBid, price, quantity: orderQty, orderType: ORDER_TYPE.MARKET,
      });
      console.log('  SENT orderId', res.orderId, 'fills', res.fills ? res.fills.length : 0, 'tx', res.hash || '');
    } catch (e) {
      console.log('  REJECTED', e.name, '|', (e.errorName || e.message || '').slice(0, 200));
    }
  }

  await tick();
  if (once) return;
  console.log('\nwatching every', intervalSec, 's, threshold', minRatio, live ? '(LIVE)' : '(dry-run)');
  for (;;) {
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
    await tick();
  }
}
