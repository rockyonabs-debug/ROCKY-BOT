# 🐧 Rocky — Autonomous AI Agent on Abstract Chain

> agentId 649 · ERC-8004 · Abstract Mainnet (chainId 2741)

Rocky is a fully autonomous AI agent living onchain on Abstract Chain. Built with OpenClaw, running 24/7.

![Rocky](https://raw.githubusercontent.com/rockyonabs-debug/ROCKY-BOT/master/rocky.png)

## What Rocky does every day

| Task | Time (UTC) | Description |
|------|-----------|-------------|
| 🗳️ Upvote | 18:30 | Votes for Abstract ecosystem apps from personal AGW via session key — no manual signing |
| 🏰 Gigaverse | 11:00 | Runs dungeons automatically every day |
| 🔥 Moody Burns | 13:00 | Burns Moody tokens onchain daily |
| 🤖 Moody Wake Up | 13:01 | Activates AI Assistants automatically |
| 📈 Grid Bot | Every 10min | Trades $PENGU on Abstract DEX |

## The key innovation — AGW session keys

Rocky votes from the **owner's personal AGW** (not from Rocky's own wallet) using **Abstract session keys**.

A one-time approval authorizes Rocky to call `voteForApp()` without requiring a signature each time. The session key is scoped exclusively to that function — Rocky cannot access funds or make any other transactions.

## Build your own agent

Full step-by-step guide to replicate this setup:

📖 **[GUIDE_AGW_UPVOTES.md](./GUIDE_AGW_UPVOTES.md)**

Covers: OpenClaw setup · Session key creation · Render deployment · Security best practices

## Rate Rocky ⭐

Community feedback improves Rocky's reputation on Abstract:

**[Rate Rocky on 8004scan →](https://8004scan.io/agents/abstract/649)**

## Links

- 🐦 Twitter: [@Rocky_onabs](https://x.com/Rocky_onabs)
- 🤖 Agent JSON: [rocky-bot-3fyr.onrender.com/agent.json](https://rocky-bot-3fyr.onrender.com/agent.json)
- 🔍 ERC-8004: [agentId 649](https://8004scan.io/agents/abstract/649)

## Tech stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js on Render (24/7) |
| Agent framework | OpenClaw |
| Wallet | Abstract Global Wallet (AGW) |
| Chain | Abstract Mainnet (chainId 2741) |
| Auth | Session keys (EIP-712) |
| Trading | Uniswap V3 Router on Abstract |
| Gaming | Gigaverse dungeon runner |
