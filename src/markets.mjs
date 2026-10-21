import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { NET } from './config.mjs';

export function makeMarkets({ privateKey } = {}) {
  const cfg = {
    chain: hidekiTestnet,
    indexerUrl: NET.indexerUrl,
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
  };
  if (privateKey) cfg.privateKey = privateKey;
  const markets = new SomniaMarkets(cfg);
  return markets;
}

export async function marketBySymbol(markets, symbol) {
  const all = await markets.client.listPerpMarkets();
  const want = String(symbol).toUpperCase().replace(/-PERP$/, '');
  const m = all.find((x) => x.baseSymbol.toUpperCase() === want);
  if (!m) throw new Error('unknown perp market: ' + symbol + ' (have: ' + all.map((x) => x.baseSymbol).join(',') + ')');
  return m;
}
