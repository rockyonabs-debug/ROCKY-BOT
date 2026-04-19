# How to Set Up an Autonomous Daily Upvote Agent on Abstract

This guide walks you through deploying your own autonomous agent that votes daily for Abstract ecosystem apps — straight from your personal AGW wallet — without ever exposing your main private key.

The agent uses a **session key**: a limited-permission key you authorize once from your browser. It can only call `voteForApp()`. It cannot move funds, approve tokens, or do anything else.

**Based on the [ROCKY-BOT](https://github.com/YOUR_GITHUB_USERNAME/ROCKY-BOT) open-source template.**

---

> ## ⚠️ SECURITY WARNING — Read Before You Start
>
> - **NEVER commit private keys, `session-config.json`, or `.env` files to GitHub.**
> - Add `session-config.json` and `.env*` to `.gitignore` **before your first commit** — not after.
> - The `.gitignore` in this repo already covers this. Do not remove those entries.
> - **If you accidentally commit sensitive data:** rotate your keys immediately, then use `git filter-repo` to scrub history. Removing the file in a new commit is NOT enough — the data remains in history.
> - GitHub bots and secret-scanning crawlers index public repos **within minutes** of a push. Assume any exposed key is already compromised.
> - A compromised **session key** can cast votes from your AGW.
> - A compromised **EOA private key** can drain your entire wallet.

---

## How it works

```
Your AGW wallet (browser)
    └── approves a session key (one-time, scoped to voteForApp only)
            └── Agent EOA holds that session key
                    └── Runs on Render 24/7
                            └── Votes daily at 20:00 UTC time
```

---

## Prerequisites

Make sure you have the following installed on your machine:

- **Node.js** v18 or higher → https://nodejs.org
- **npm** (comes with Node.js)
- **Git** → https://git-scm.com
- **A GitHub account** → https://github.com
- **A Render account** (free tier works) → https://render.com
- **MetaMask or any wallet** connected to Abstract mainnet with your AGW

Check your versions:
```bash
node --version   # should be v18+
npm --version
git --version
```

---

## Step 1 — Install OpenClaw and run the gateway

OpenClaw is the local gateway that lets your agent interact with Abstract Chain.

```bash
npm install -g openclaw
```

Start the local gateway:
```bash
openclaw start
```

Leave this running in a terminal. You should see:
```
OpenClaw gateway running on http://localhost:4747
```

---

## Step 2 — Clone the ROCKY-BOT repo as your template

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/ROCKY-BOT.git my-vote-agent
cd my-vote-agent
npm install
```

This gives you the full working agent. You will customize it with your own wallet addresses and session key.

---

## Step 3 — Generate your agent EOA

Your agent needs its own Ethereum wallet (EOA) to hold the session key. This is **not** your main wallet — it only gets permission to vote.

Generate a new wallet:
```bash
node -e "
const { privateKeyToAccount, generatePrivateKey } = require('viem/accounts');
const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);
console.log('Private key:', pk);
console.log('Address:', account.address);
"
```

Save both values somewhere safe:
- `Private key` → this becomes `ROCKY_EOA_PRIVATE_KEY` in Render
- `Address` → this is your agent EOA address

> **Never share the private key.** It will only be stored in Render's environment variables, never in the code.

---

## Step 4 — Create the session key (the critical step)

This is where you authorize the agent EOA to vote on behalf of your personal AGW — scoped strictly to `voteForApp()`.

### 4a — Edit the session key app config

Open `session-keys-app/src/config.js` (or equivalent config file in the repo) and set:
```js
// The agent EOA address you generated in Step 3
export const AGENT_EOA = "0xYOUR_AGENT_EOA_ADDRESS";

// Your personal AGW address (the wallet that will approve the session)
export const YOUR_AGW = "0xYOUR_PERSONAL_AGW_ADDRESS";
```

### 4b — Run the session key app locally

```bash
cd session-keys-app
npm install
npm run dev
```

Open your browser at `http://localhost:5173`

### 4c — Approve the session key from your AGW

1. Connect your wallet (the personal AGW that will be doing the voting)
2. Click **"Create Session Key"**
3. Review the permissions — it should show **only** `voteForApp()` on the voting contract `0x3B50dE27506f0a8C1f4122A1e6F470009a76ce2A`
4. Approve the transaction in your wallet

> **What you are signing:** Permission for the agent EOA to call `voteForApp(uint256)` on your behalf. That is the only function it can ever call. It cannot transfer tokens, approve contracts, or interact with anything else.

### 4d — Save the session config

After approval the app will display a JSON object. Copy it and save it as `session-config.json` in the root of `my-vote-agent/`:

```json
{
  "session": {
    "expiresAt": "...",
    "feeLimit": { ... },
    "callPolicies": [ ... ]
  }
}
```

This file tells the agent how to reconstruct the session client at runtime.

> 🚨 **NEVER commit `session-config.json` to git.** It is listed in `.gitignore` for a reason. Anyone with this file can cast votes from your personal AGW. Keep it on disk locally and deploy it to Render as a Secret File (Dashboard → your service → Secret Files). Do not paste it into environment variables either — it is a JSON object, not a string.

---

## Step 5 — Customize the vote rotation

Open `upvote.mjs` and update two things:

**Your personal AGW address** (line 20):
```js
account: "0xYOUR_PERSONAL_AGW_ADDRESS",
```

**The app IDs you want to vote for** (line 15):
```js
const APP_IDS = [39n, 213n, 222n, 15n, 150n, 223n, 207n];
```

Find app IDs at https://abs.xyz/vote — each app listed there has a numeric ID. You can vote for 1 app per day, so pick up to 7 (one per day of the week) or repeat your favorites.

---

## Step 6 — Push your customized repo to GitHub

Create a new repo on GitHub (e.g. `my-vote-agent`), then:

```bash
git remote set-url origin https://github.com/YOUR_USERNAME/my-vote-agent.git
git add .
git commit -m "Configure agent for my AGW"
git push origin master
```

> ⚠️ **Never commit `session-config.json`** — it's in `.gitignore` for a reason. It contains your session key. Keep it local only and deploy it via Render's Secret Files feature (see Step 7). Double-check that `.env` files are also in `.gitignore` and never committed.

---

## Step 7 — Deploy to Render as a Background Worker

1. Go to https://render.com and click **New → Background Worker**
2. Connect your GitHub account and select your `my-vote-agent` repo
3. Set the following:
   - **Name**: `my-vote-agent` (or anything you like)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node index.js`
4. Click **Create Background Worker**
5. Go to **Secret Files** → add a file at path `./session-config.json` and paste the contents of your local `session-config.json` there — this is the safe way to deploy it without committing it to git

---

## Step 8 — Set environment variables in Render

In your Render service → **Environment** tab, add:

| Key | Value |
|-----|-------|
| `PRIVATE_KEY` | The agent EOA private key from Step 3 (used by grid bot and gigaverse signing) |
| `ROCKY_EOA_PRIVATE_KEY` | Same agent EOA private key (used by upvote.mjs session signer) |

Click **Save Changes** — Render will redeploy automatically.

> Both variables hold the same EOA private key. They exist separately because `index.js` and `upvote.mjs` reference different env var names.

---

## Step 9 — Verify the vote works

### Check Render logs

In your Render service → **Logs** tab, after deploy you should see:

```
[2026-04-18T20:00:01.000Z] 🐧 Rocky is online — Abstract Chain, let's go!
[2026-04-18T20:00:01.000Z] ⏰ Vote (20:00 UTC) in 237 min
```

At 17:00 UTC time you should see:
```
[2026-04-18T20:00:01.000Z] 🗳️ Casting daily vote from personal AGW...
Intentando votar appId 39...
Voto enviado para appId 39. TX: 0x...
[2026-04-18T20:00:03.000Z] ✅ Personal vote done
```

### Confirm on-chain

Copy the TX hash from the logs and check it on the Abstract explorer:
`https://abscan.org/tx/0xYOUR_TX_HASH`

You should see a `voteForApp` call originating from your personal AGW address.

---

## Troubleshooting

**`Cannot find module '@abstract-foundation/agw-client'`**
→ Run `npm install` again, or check that Render's Build Command is set to `npm install`.

**`TypeError: Cannot read properties of undefined (reading 'slice')`**
→ The `ROCKY_EOA_PRIVATE_KEY` env var is missing or empty in Render. Double-check it starts with `0x`.

**`execution reverted` on all app IDs**
→ Your AGW already voted for all apps today. The agent will try again tomorrow automatically.

**`session expired` or `unauthorized`**
→ The session key has expired. Repeat Step 4 to generate and approve a new one, then redeploy.

---

## Security summary

| What the session key CAN do | What it CANNOT do |
|-----------------------------|-------------------|
| Call `voteForApp(uint256)` on the voting contract | Transfer ETH or any token |
| Vote from your personal AGW address | Approve token spending |
| | Interact with any other contract |
| | Sign arbitrary messages |

Your AGW funds are safe. The worst case if the agent EOA private key were ever compromised is that someone could cast votes on your behalf.

---

## 🔐 Security Checklist

Before you consider your deployment complete, verify every item:

- [ ] `.gitignore` includes `session-config.json`, `.env`, and `.env*`
- [ ] `session-config.json` is **never** committed to the repo — deploy it via Render Secret Files only
- [ ] Private keys are stored **only** in Render environment variables, never written in any code file
- [ ] Session key scope is verified — the `callPolicies` in `session-config.json` should show only `voteForApp()` on `0x3B50dE27506f0a8C1f4122A1e6F470009a76ce2A`, nothing else
- [ ] You know how to revoke the session key anytime from the session-keys-app if needed
- [ ] You have rotated keys if anything was ever accidentally committed

---

## Resources

- ROCKY-BOT repo: https://github.com/YOUR_GITHUB_USERNAME/ROCKY-BOT
- Abstract AGW docs: https://docs.abs.xyz
- Abstract vote page: https://abs.xyz/vote
- Render docs: https://render.com/docs/background-workers
- Rocky on Twitter: https://x.com/Rocky_onabs
