// Open a real perp order on Somnia Tokyo testnet, with the pre-trade gate in front of it.
//
// This is the only command in this bot that broadcasts a transaction. It is deliberately
// shaped so that the dangerous part is explicit:
//
//   node cli.mjs open --market BTC --side long --notional 250 --dry-run
//   node cli.mjs open --market BTC --side long --notional 250
//
// --dry-run is the default in the sense that nothing is broadcast without the key being
// present AND --dry-run being absent. The gate runs first and refuses the order if the
// account cannot carry it, so a fat-fingered notional cannot become a liquidation.
import { createPublicClient, http, formatUnits } from 'viem';
import { NET, fmt, alignDown } from './config.mjs';
import { makeMarkets, marketBySymbol } from './markets.mjs';

const POOL_ABI = [
  'function getPerpPoolParameters() view returns ((uint256 initialMarginBps, uint256 maintenanceMarginBps, uint256 closeOutMarginBps, uint256 maxOpenInterest, uint256 maxPositionSize, uint256 takerFeeBpsTimes1k, int256 makerFeeBpsTimes1k, uint256 insuranceFundShareBps))',
];

// orderType: 0 limit, 1 fill-or-kill, 2 market, 3 post-only
const TYPES = { limit: 0, fok: 1, market: 2, post: 3 };

export async function cmdOpen(args) {
  const dryRun = args['dry-run'] !== false && args.live !== true;
  const key = process.env.BOT_PRIVATE_KEY;
  const symbol = args.market || 'BTC';
  const side = String(args.side || 'long').toLowerCase().startsWith('l');
  const typeName = String(args.type || 'limit').toLowerCase();
  const orderType = TYPES[typeName];
  if (orderType === undefined) throw new Error('unknown --type ' + typeName + ' (limit|fok|market|post)');

  const markets = makeMarkets({ privateKey: dryRun ? undefined : key });
  const m = await marketBySymbol(markets, symbol);
  const account = String(args.account || process.env.BOT_ADDRESS || '').toLowerCase();
  if (!account) throw new Error('set BOT_ADDRESS (or pass --account)');

  const rpc = createPublicClient({ transport: http(NET.rpcUrl) });
  const st = await markets.client.getPerpState(m.poolAddress);
  const mark = st.markPrice;
  if (!st.markPriceOk) throw new Error('mark price is stale, refusing to size against it');

  // ---- the gate: how big can this account actually be, right now ----
  const max = await markets.client.getMaxPerpOrderSize({
    pool: m.poolAddress, marginBank: m.marginBank, account, isBid: side, price: mark,
  });
  const dec = m.baseDecimals;
  const notional = BigInt(Math.round(Number(args.notional || 0) * 1e6)) * 10n ** 12n;
  const want = alignDown((notional * 10n ** BigInt(dec)) / mark, max.lotSize);
  const qty = want > max.maxQuantity ? max.maxQuantity : want;

  console.log('market          ', m.baseSymbol, '| pool', m.poolAddress);
  console.log('side / type     ', side ? 'LONG (buy)' : 'SHORT (sell)', '/', typeName);
  console.log('mark price      ', fmt(mark, 18), st.markPriceOk ? '' : '(STALE)');
  console.log('notional asked  ', args.notional, 'USDso ->', fmt(want, dec), m.baseSymbol);
  console.log('cap             ', fmt(max.maxQuantity, dec), m.baseSymbol, '| limited by', max.limitedBy);
  console.log('quantity to send', fmt(qty, dec), m.baseSymbol,
    qty < want ? '(CAPPED from ' + fmt(want, dec) + ')' : '(within caps)');
  console.log('lock amount     ', fmt(max.lockAmount, 18), 'USDso | top-up', fmt(max.topUpRequired, 18));
  console.log('placeable       ', max.placeable);

  if (!max.placeable) throw new Error('account cannot place this order: limited by ' + max.limitedBy);
  if (qty < max.minQuantity) {
    throw new Error('quantity ' + fmt(qty, dec) + ' is below minQuantity ' + fmt(max.minQuantity, dec));
  }
  if (qty % max.lotSize !== 0n) throw new Error('quantity is not a multiple of lotSize');

  if (dryRun) {
    console.log('');
    console.log('DRY RUN - nothing broadcast. re-run with --live to send.');
    return;
  }
  if (!key) throw new Error('BOT_PRIVATE_KEY is not set (mvp-bot/.env.botkey)');

  // ---- broadcast ----
  const price = orderType === 2 ? mark : mark; // market orders take a crossing price as the bound
  const tx = await markets.trader.placePerpOrder({
    pool: m.poolAddress, isBid: side, price, quantity: qty, orderType,
  });
  console.log('');
  console.log('BROADCAST       ', tx.hash || tx.transactionHash || JSON.stringify(tx).slice(0, 90));
  console.log('order id        ', tx.orderId ?? '-');
  console.log('fills           ', (tx.fills || []).length);
  for (const f of tx.fills || []) {
    console.log('  ', fmt(f.quantity, dec), '@', fmt(f.price, 18), '=', fmt(f.cost ?? 0n, 18), 'USDso');
  }
  console.log('');
  console.log('verify on chain: cast receipt', (tx.hash || '').slice(0, 20) + '... --rpc-url ' + NET.rpcUrl);
  return tx;
}

// Fund the account: claim the one-time paper USDso voucher, then deposit it into the MarginBank.
// Two transactions, both from the bot key. Claiming requires the account to be flat.
export async function cmdFund(args) {
  const key = process.env.BOT_PRIVATE_KEY;
  const dryRun = args['dry-run'] !== false && args.live !== true;
  const markets = makeMarkets({ privateKey: dryRun ? undefined : key });
  const m = await marketBySymbol(markets, args.market || 'BTC');
  const account = String(args.account || process.env.BOT_ADDRESS || '').toLowerCase();
  if (!account) throw new Error('set BOT_ADDRESS (or pass --account)');

  const rpc = createPublicClient({ transport: http(NET.rpcUrl) });
  const bal = await rpc.getBalance({ address: account });
  console.log('account         ', account);
  console.log('native balance  ', formatUnits(bal, 18), 'STT  (gas)');

  const el = await markets.client.getPerpVoucherEligibility(m.marginBank, account);
  console.log('voucher         ', 'eligible=' + el.eligible, '| reason=' + (el.reason || '-'),
    '| amount=' + (el.amount === undefined ? '-' : fmt(el.amount, 18)), 'USDso');

  if (!el.eligible) {
    console.log('not eligible for the paper USDso credit:', el.reason || JSON.stringify(el));
    return;
  }
  if (dryRun) {
    console.log('DRY RUN - nothing broadcast. re-run with --live to claim.');
    return;
  }
  const tx = await markets.trader.claimPerpVoucher({ marginBank: m.marginBank });
  console.log('voucher claimed ', tx.hash || JSON.stringify(tx).slice(0, 90));

  // deposit the whole credit so the account has margin to trade with
  const amount = BigInt(args.amount || 1000) * 10n ** 18n;
  const dep = await markets.trader.depositMargin({ marginBank: m.marginBank, amount });
  console.log('margin deposited', dep.hash || JSON.stringify(dep).slice(0, 90), fmt(amount, 18), 'USDso');
  return { claim: tx, deposit: dep };
}
