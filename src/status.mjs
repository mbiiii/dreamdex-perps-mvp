import { NET, fmt, pct } from './config.mjs';
import { makeMarkets } from './markets.mjs';

// Annualises a per-window funding rate the way the pool defines it: the rate is per
// fundingWindowSec (28800 on every live pool), so periods per year = 31_536_000 / window.
export function fundingApr(rateX18, windowSec) {
  if (!windowSec) return 0;
  const perYear = 31_536_000 / Number(windowSec);
  return (Number(rateX18) / 1e18) * perYear * 100;
}

export async function cmdStatus(args) {
  const account = String(args.account || process.env.BOT_ADDRESS || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(account)) {
    throw new Error('need an account: --account 0x... (or BOT_ADDRESS in .env.botkey)');
  }
  const markets = makeMarkets();
  const all = await markets.client.listPerpMarkets();
  const byPool = new Map(all.map((m) => [m.poolAddress.toLowerCase(), m]));

  const health = await markets.client.getAccountHealth(NET.marginBank, account);
  console.log('account        ' + account);
  console.log('equity         ' + fmt(health.equity, 18) + ' USDso');
  console.log('initial  req   ' + fmt(health.imReq, 18));
  console.log('maintenance    ' + fmt(health.mmReq, 18));
  console.log('closeout       ' + fmt(health.cmReq, 18));
  console.log('margin status  ' + String(health.marginStatus));
  if (health.mmReq > 0n) {
    console.log('equity / MM    ' + pct(health.equity, health.mmReq) + '   (100% = at the maintenance line)');
    console.log('buffer above MM ' + fmt(health.equity - health.mmReq, 18) + ' USDso');
  }

  const rows = await markets.client.listPerpPositionAnalytics({ marginBank: NET.marginBank, account });
  const open = rows.filter((r) => r.size !== 0n);
  console.log('');
  console.log('positions      ' + open.length + '   (cross margin: margin is account-wide, so there is no per-position liquidation price)');

  let totNotional = 0n;
  let totIm = 0n;
  let totMm = 0n;
  for (const r of open) {
    const m = byPool.get(String(r.pool).toLowerCase());
    const dec = m ? m.baseDecimals : 18;
    const sym = m ? m.baseSymbol : String(r.pool).slice(0, 8);
    const side = r.size > 0n ? 'LONG' : 'SHORT';
    const abs = r.size > 0n ? r.size : -r.size;
    if (!r.priceable) {
      console.log('  ' + sym.padEnd(9) + side.padEnd(6) + ' size ' + fmt(abs, dec) + '   (mark feed stale, row not marked)');
      continue;
    }
    totNotional += r.notional;
    totIm += r.initialMarginRequirement;
    totMm += r.maintenanceMarginRequirement;
    const rom = r.returnOnMarginBps !== null ? (Number(r.returnOnMarginBps) / 100).toFixed(2) + '%' : '-';
    console.log(
      '  ' + sym.padEnd(9) + side.padEnd(6) +
      ' size ' + fmt(abs, dec).padEnd(13) +
      ' entry ' + fmt(r.avgEntryPrice, 18).padEnd(13) +
      ' mark ' + fmt(r.markPrice, 18).padEnd(13) +
      ' uPnL ' + fmt(r.unrealizedPnl, 18).padEnd(11) +
      ' funding ' + fmt(r.accruedFunding, 18).padEnd(9) +
      ' ROM ' + rom
    );
  }

  console.log('');
  console.log('totals         notional ' + fmt(totNotional, 18) + ' | IM req ' + fmt(totIm, 18) + ' | MM req ' + fmt(totMm, 18));
  console.log('cross-margin   ' + (health.imReq > 0n ? 'account leverage ' + (Number(totNotional) / Number(health.equity)).toFixed(2) + 'x on equity' : 'flat'));

  console.log('');
  console.log('funding, annualised (rate is per 8h window, read per pool):');
  const fr = [];
  for (const m of all) {
    const st = await markets.client.getPerpState(m.poolAddress);
    fr.push({ sym: m.baseSymbol, apr: fundingApr(st.fundingRate, st.fundingWindowSec), ok: st.markPriceOk });
  }
  fr.sort((a, b) => Math.abs(b.apr) - Math.abs(a.apr));
  for (const r of fr.slice(0, 10)) {
    console.log('  ' + r.sym.padEnd(10) + (r.apr >= 0 ? '+' : '') + r.apr.toFixed(2) + '%' + (r.ok ? '' : '  (mark feed stale)'));
  }
  console.log('');
  console.log('positive APR = longs pay shorts. The largest |APR| is where a funding carry pays; the sign says which side receives.');
}
