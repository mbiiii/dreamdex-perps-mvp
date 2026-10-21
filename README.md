# perps-guardian

Auto-deleverage guard and pre-trade size gate for dreamDEX perps on Somnia Tokyo testnet.

Built for the dreamDEX Perps Builder Bounty (feedback + MVP tracks).

## What it does

Three commands, in the order a trader actually needs them:

```
gate     how big can this order actually be, read from the chain rather than the docs table
open     place the order, with the gate in front of it
guard    watch the account and deleverage before the liquidation engine does
```

The problem it solves: the docs say each account is capped at "a tenth of the market's open
interest cap". On the live chain that is true for one market out of 21. A bot that sizes from the
docs table either leaves most of its margin unused or gets its order rejected, and a trader that
does not know the real cap finds out by being liquidated. `gate` reads `maxPositionSize`,
`maxOpenInterest`, `lotSize`, `minQuantity` and the account's own collateral off the chain and
returns the largest order that will actually land.

`guard` is the same idea applied after the fact: it reads equity against the maintenance
requirement and, below a configurable ratio, reduces the position by a fraction. Dry-run by
default; it never broadcasts without `--live`.

## Install

```
npm install
cp .env.example .env.botkey      # then fill in BOT_PRIVATE_KEY and BOT_ADDRESS
```

`.env.botkey` is gitignored. The key is the bot key you linked to your dreamDEX account with
Link a Bot; the address is the wallet that holds the margin.

## Usage

```
# what the docs claim vs what the chain enforces
node cli.mjs gate --market BTC --side long --notional 2500

# account health, positions, funding APR per market
node cli.mjs status --account 0x...

# claim the one-time paper USDso voucher and deposit it as margin (2 txs)
node cli.mjs fund --market BTC --live

# place a real order. gate runs first; dry-run unless --live
node cli.mjs open --market BTC --side long --notional 250 --dry-run
node cli.mjs open --market BTC --side long --notional 250 --live

# auto-deleverage loop
node cli.mjs guard --account 0x... --min-ratio 1.5 --fraction 0.5 --once
node cli.mjs guard --account 0x... --live
```

`open` refuses to broadcast when the mark price is stale, when the account is not `placeable`,
when the quantity is below `minQuantity`, or when it is not a multiple of `lotSize`. Every one of
those is a revert on chain, so catching them first costs nothing and keeps the log readable.

## Verified output

`gate` on the BTC market, against the live testnet:

```
market            BTC | pool 0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0
mark / index      84626.8665640196105 / 84626.8665640196105
open interest     91 BTC
maxPositionSize   100 BTC   <- the real per-account cap
maxOpenInterest   493.6309 BTC  (maxOI / maxPos = 4.94)
docs say          1/10 of the OI cap on most markets; live ratio here is 1/4.94
effective IMF     10.00% (static, dynamic IMF off)
lot / min         0.001 / 0.013
placeable now     false | limited by collateral
max quantity      0 BTC
position size     0 BTC (flat)
lock amount       0 USDso  |  top-up 0
```

`guard` against a flat account:

```
18:19:11 flat: equity 0 no maintenance requirement, nothing to guard
```

## X posts

<!-- Replace these with the real post URLs after posting. The bounty requires 2-3 posts
     tagging @DreamDEXSomnia. Suggested angles:
       1. the docs-vs-chain cap gap this bot exists to close (the 1/20, 1/40, 1/4.94 numbers)
       2. a short clip of `gate` refusing an order that the docs would have let through
       3. the funding-APR table from `status`, with the sign convention explained -->

1. <post url 1>
2. <post url 2>
3. <post url 3>

## Environment

```
chain      Somnia Tokyo testnet, chain ID 50383
RPC        https://api.hideki2.infra.testnet.somnia.network
indexer    https://hideki-dev.smk.somnia.host/v1/graphql
SDK        @somnia-chain/markets-sdk 0.32.1
```

## Safety notes

- The bot key is a hot key. Link it with Link a Bot so it can trade one wallet and nothing else,
  and keep the wallet's funds to what you are willing to lose on a testnet.
- `guard --live` reduces positions on its own. Run it with `--once` first and read the output
  before letting it loop.
- Nothing here has been audited. It is a bounty submission, not production software.
