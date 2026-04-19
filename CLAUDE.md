# Rocky — Autonomous AI Agent on Abstract Chain

## Identity
- **Agent name**: Rocky (Rockhopper penguin from Patagonia)
- **AgentId**: 649
- **Standard**: ERC-8004
- **Chain**: Abstract Mainnet (chainId 2741)
- **Deployed at**: https://rocky-bot-3fyr.onrender.com (Render)

## Wallets
| Role | Address |
|------|---------|
| Rocky AGW | `0xF18eB4A8E35b23C1a4D67012D73d0670a8152c50` |
| Rocky EOA | `0x8a16261bE29306c8985C50c953dee51fc78C7E3C` |
| Owner personal AGW | `0xaF7B17E7bbF5A21DeB480711959da0830A93199b` |
| Session signer (upvote) | `0x689CBD56c4f063762d571F265FBA8E47A5abf67e` — new, replaces exposed `0x33F42E...` |

## Daily Schedule (Argentina time)
| Time | Task |
|------|------|
| 10:00 | Moody AI Assistants activation (`doMoodyAssistants`) |
| 17:00 | Ecosystem vote from personal AGW via session key (`upvote.mjs`) |
| 17:00 | Gigaverse dungeon run (`runGigaverseDungeon`) — currently set at 17:00 for testing |

## Grid Bot
- Trades PENGU/ETH on Abstract via Uniswap-style Router
- **PENGU**: `0x9eBe3A824Ca958e4b3Da772D2065518F009CBa62`
- **WETH**: `0x3439153EB7AF838Ad19d56E1571FBD09333C2809`
- **Router**: `0xE1b076ea612Db28a0d768660e4D81346c02ED75e`
- **Pair**: `0xda7d037fda848177141e037f9d0c67cae7b53262`
- Trade size: 0.0003 ETH, grid spacing: 2%, 5 levels
- Resets grid when price drifts >25% from base
- Runs every 10 minutes

## Voting (`upvote.mjs`)
- Uses session key on owner personal AGW (`0xaF7B17E7bbF5A21DeB480711959da0830A93199b`)
- Rotates through 7 app IDs (one per day of week): `[39, 213, 222, 15, 150, 223, 207]`
- Falls back to next app in list if today's was already voted

## Key Files
| File | Purpose |
|------|---------|
| `index.js` | Main entry: HTTP server, grid bot, vote, schedules |
| `upvote.mjs` | Daily ecosystem vote via session key |
| `gigaverse.js` | Gigaverse dungeon automation |
| `moody.js` | Moody AI Assistants activation |
| `session-config.json` | Session key config for personal AGW voting |

## Environment Variables
| Var | Used for |
|-----|---------|
| `PRIVATE_KEY` | Rocky EOA — signs AGW transactions |
| `ROCKY_PRIVATE_KEY` / `ROCKY_EOA_PRIVATE_KEY` | Session signer in upvote.mjs |
| `PORT` | HTTP server port (default 3000) |

## x402 Paid Services
Rocky exposes two pay-per-request endpoints using the x402 protocol (HTTP 402 Payment Required).
Payments settle in USDC on Abstract mainnet. Rocky's AGW (`0xF18eB4A8E35b23C1a4D67012D73d0670a8152c50`) receives all payments.
Facilitator: `https://facilitator.x402.abs.xyz` (free, gas sponsored by Abstract).

| Route | Method | Price | Action |
|-------|--------|-------|--------|
| `/vote` | POST | $0.05 USDC | Triggers `doPersonalVote()` — casts Rocky's daily ecosystem vote |
| `/gigaverse` | POST | $0.10 USDC | Triggers `runGigaverseDungeon()` — runs Gigaverse dungeons until energy depleted |

USDC token on Abstract: `0x84A71ccD554Cc1b02749b35d22F684CC8ec987e1` (EIP-3009 compatible)

## Skills
| File | Purpose |
|------|---------|
| `skills/openclaw-max-leverage.md` | GPT-5.4 OpenClaw Max-Leverage Prompt — plan-first execution protocol for high-stakes tasks spanning research, tool use, and long-context workflows. Variables: `{TASK}`, `{OUTPUT_FORMAT}`, `{RISK_LEVEL}`, `{TIME_BUDGET}`, `{SOURCE_URLS}`, `{CONSTRAINTS}` |

## Pending / In Progress
- **Moody wake-up API**: Needs PlayFab integration to trigger assistant activation
- **Tweets reactivation**: Twitter/X posting was disabled, needs to be restored
- **ERC-8004 reputation**: Improve Rocky's on-chain reputation score (agentId 649)
