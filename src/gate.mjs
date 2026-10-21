import { parseAbiItem, createPublicClient, http } from 'viem';
import { NET, fmt, alignDown } from './config.mjs';
import { makeMarkets, marketBySymbol } from './markets.mjs';

const POOL_ABI = [
  parseAbiItem('function getPerpPoolParameters() view returns ((uint256 initialMarginBps, uint256 maintenanceMarginBps, uint256 closeOutMarginBps, uint256 maxOpenInterest, uint256 maxPositionSize, uint256 takerFeeBpsTimes1k, int256 makerFeeBpsTimes1k, uint256 insuranceFundShareBps))'),
];

// The pre-trade gate. Answers "how big can this order actually be" from the chain,
// not from the docs table: maxPositionSize is 1/20 of open interest on most markets,
// 1/40 on the 5x ones, and the Paper USDso allowlist is per pool.
export async function cmdGate(args) {
  const markets = makeMarkets();
  const rpc = createPublicClient({ transport: http(NET.rpcUrl) });
  const m = await marketBySymbol(markets, args.market || 'BTC');
  const account = String(args.account || process.env.BOT_ADDRESS || '0x0000000000000000000000000000000000000001').toLowerCase();
  const isBid = String(args.side || 'long').toLowerCase().startsWith('l');

  const st = await markets.client.getPerpState(m.poolAddress);
  const mark = st.markPrice;
  const params = await rpc
    .readContract({ address: m.poolAddress, abi: POOL_ABI, functionName: 'getPerpPoolParameters' })
    .catch(() => null);

  const max = await markets.client.getMaxPerpOrderSize({
    pool: m.poolAddress,
    marginBank: m.marginBank,
    account,
    isBid,
    price: mark,
  });

  const dec = m.baseDecimals;
  console.log('market            ', m.baseSymbol, '| pool', m.poolAddress);
  console.log('mark / index      ', fmt(st.markPrice, 18), '/', fmt(st.indexPrice, 18), st.markPriceOk ? '' : '(STALE)');
  console.log('open interest     ', fmt(st.openInterest, dec), m.baseSymbol);
  console.log('maxPositionSize   ', fmt(max.maxPositionSize, dec), m.baseSymbol, ' <- the real per-account cap');
  if (params) {
    const ratio = Number(params.maxOpenInterest) / Number(params.maxPositionSize);
    console.log('maxOpenInterest   ', fmt(params.maxOpenInterest, dec), m.baseSymbol, ' (maxOI / maxPos = ' + ratio.toFixed(2) + ')');
    console.log('docs say          1/10 of the OI cap on most markets; live ratio here is 1/' + ratio.toFixed(2));
  }
  console.log('effective IMF     ', (Number(max.effectiveImfBps) / 100).toFixed(2) + '%',
    Number(max.effectiveImfBps) === Number(m.initialMarginBps) ? '(static, dynamic IMF off)' : '(dynamic IMF on)');
  console.log('lot / min         ', fmt(max.lotSize, dec), '/', fmt(max.minQuantity, dec));
  console.log('placeable now     ', max.placeable, '| limited by', max.limitedBy);
  console.log('max quantity      ', fmt(max.maxQuantity, dec), m.baseSymbol);
  const ps = max.positionSize ?? 0n;
  console.log('position size     ', fmt(ps < 0n ? -ps : ps, dec), ps === 0n ? '(flat)' : ps > 0n ? 'LONG' : 'SHORT');
  console.log('lock amount       ', fmt(max.lockAmount, 18), 'USDso  |  top-up', fmt(max.topUpRequired, 18));

  if (args.notional) {
    const notional = BigInt(Math.round(Number(args.notional) * 1e6)) * 10n ** 12n; // 18dp quote
    const want = alignDown((notional * 10n ** BigInt(dec)) / mark, max.lotSize);
    const capped = want > max.maxQuantity ? max.maxQuantity : want;
    console.log('');
    console.log('requested         ', args.notional, 'USDso ->', fmt(want, dec), m.baseSymbol,
      capped < want ? '(CAPPED to ' + fmt(capped, dec) + ' by ' + max.limitedBy + ')' : '(within caps)');
  }
}
