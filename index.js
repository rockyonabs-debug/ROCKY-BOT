import { createPublicClient, http, parseEther, formatEther, encodePacked, encodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { abstract } from "viem/chains";
import { createAbstractClient } from "@abstract-foundation/agw-client";
import fetch from "node-fetch";

// ── CONFIG ──
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENTWEET_KEY = process.env.OPENTWEET_KEY;
const AGW_ADDRESS = "0xF18eB4A8E35b23C1a4D67012D73d0670a8152c50";
const PENGU = "0x9eBe3A824Ca958e4b3Da772D2065518F009CBa62";
const WETH = "0x3439153EB7AF838Ad19d56E1571FBD09333C2809";
const ROUTER = "0xE1b076ea612Db28a0d768660e4D81346c02ED75e";
const PAIR = "0xda7d037fda848177141e037f9d0c67cae7b53262";
const RPC_URL = "https://api.mainnet.abs.xyz";
const ETH_RESERVE = parseEther("0.003");
const TRADE_SIZE = parseEther("0.0003");
const GRID_SPACING = 0.02;
const GRID_LEVELS = 5;
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

// ── CIRCUIT BREAKER ──
let circuitOpen = false;
let circuitFailures = 0;
let circuitLastFail = null;
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_RESET_MS = 5 * 60 * 1000; // 5 min

function checkCircuit() {
  if (!circuitOpen) return true;
  if (Date.now() - circuitLastFail > CIRCUIT_RESET_MS) {
    circuitOpen = false;
    circuitFailures = 0;
    log("⚡ Circuit breaker reset — resuming operations");
    return true;
  }
  return false;
}

function recordFailure(context) {
  circuitFailures++;
  circuitLastFail = Date.now();
  if (circuitFailures >= CIRCUIT_THRESHOLD) {
    circuitOpen = true;
    log(`🔴 Circuit breaker OPEN after ${circuitFailures} failures in ${context} — pausing 5 min`);
  }
}

function recordSuccess() {
  circuitFailures = 0;
}

// ── LOGGER ──
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── RETRY WRAPPER ──
async function withRetry(fn, label, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await fn();
      recordSuccess();
      return result;
    } catch (err) {
      const msg = err.shortMessage || err.message;
      log(`⚠️ ${label} failed (attempt ${i+1}/${retries}): ${msg}`);
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1)));
      } else {
        recordFailure(label);
        throw err;
      }
    }
  }
}

// ── ABIs ──
const ERC20_ABI = [
  { name: "balanceOf", type: "function", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }
];
const ROUTER_ABI = [{
  name: "execute", type: "function", stateMutability: "payable",
  inputs: [{ name: "commands", type: "bytes" }, { name: "inputs", type: "bytes[]" }],
  outputs: []
}];

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: abstract, transport: http(RPC_URL) });

// ── PRICE ──
async function getPrice() {
  return withRetry(async () => {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/pairs/abstract/${PAIR}`, { timeout: 8000 });
    if (!r.ok) throw new Error(`DexScreener HTTP ${r.status}`);
    const d = await r.json();
    const price = parseFloat(d.pair?.priceUsd);
    if (!price || isNaN(price)) throw new Error("Invalid price response");
    return { price, change: parseFloat(d.pair?.priceChange?.h24 || 0) };
  }, "getPrice");
}

// ── BALANCES ──
async function getBalances() {
  return withRetry(async () => {
    const [eth, pengu] = await Promise.all([
      publicClient.getBalance({ address: AGW_ADDRESS }),
      publicClient.readContract({
        address: PENGU, abi: ERC20_ABI,
        functionName: "balanceOf", args: [AGW_ADDRESS]
      })
    ]);
    return { eth, pengu };
  }, "getBalances");
}

// ── VALIDATE BEFORE TRADE ──
async function validateTradeConditions(type, balances) {
  if (type === "buy") {
    const ethFree = balances.eth - ETH_RESERVE;
    if (ethFree < TRADE_SIZE) {
      log(`⛔ Buy blocked — insufficient ETH: ${formatEther(ethFree)} free`);
      return false;
    }
  }
  if (type === "sell") {
    if (balances.pengu <= 0n) {
      log(`⛔ Sell blocked — no PENGU to sell`);
      return false;
    }
  }
  return true;
}

// ── BUY ──
async function buyPengu(agwClient, amount) {
  return withRetry(async () => {
    const commands = "0x0b00";
    const wrapInput = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      ["0x0000000000000000000000000000000000000002", amount]
    );
    const path = encodePacked(["address", "uint24", "address"], [WETH, 3000, PENGU]);
    const swapInput = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }],
      [AGW_ADDRESS, amount, 0n, path, false]
    );
    const hash = await agwClient.writeContract({
      address: ROUTER, abi: ROUTER_ABI, functionName: "execute",
      value: amount, args: [commands, [wrapInput, swapInput]]
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }, "buyPengu");
}

// ── SELL ──
async function sellPengu(agwClient, penguAmount) {
  return withRetry(async () => {
    const approveHash = await agwClient.writeContract({
      address: PENGU, abi: ERC20_ABI, functionName: "approve", args: [ROUTER, penguAmount]
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    const path = encodePacked(["address", "uint24", "address"], [PENGU, 3000, WETH]);
    const swapInput = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }],
      [AGW_ADDRESS, penguAmount, 0n, path, true]
    );
    const hash = await agwClient.writeContract({
      address: ROUTER, abi: ROUTER_ABI, functionName: "execute",
      args: ["0x00", [swapInput]]
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }, "sellPengu");
}

// ── GRID STATE ──
let basePrice = null;
let grid = [];
let lastTradeAction = "watching the market";
let lastTweetStyle = 0;
let tweetHistory = []; // Memory of last 3 tweets to avoid repetition

function buildGrid(price) {
  return Array.from({ length: GRID_LEVELS }, (_, i) => ({
    level: i + 1,
    buyPrice: price * (1 - GRID_SPACING * (i + 1)),
    sellPrice: price * (1 + GRID_SPACING * (i + 1)),
    filled: false
  }));
}

// ── GRID TRADING ──
async function runGrid() {
  if (!checkCircuit()) {
    log("🔴 Circuit open — skipping grid cycle");
    return;
  }

  try {
    const agwClient = await createAbstractClient({
      signer: account, chain: abstract, transport: http(RPC_URL)
    });

    const { price } = await getPrice();
    const balances = await getBalances();
    const ethFree = balances.eth - ETH_RESERVE;

    log(`🐧 Grid | ETH: ${formatEther(balances.eth)} | PENGU: ${(Number(balances.pengu)/1e18).toFixed(2)} | Price: $${price}`);

    if (!basePrice) {
      basePrice = price;
      grid = buildGrid(price);
      lastTradeAction = `grid initialized at $${price}`;
      log(`Grid built — buy levels: ${grid.map(g=>'$'+g.buyPrice.toFixed(6)).join(', ')}`);
      return;
    }

    // Check buy levels
    for (const level of grid) {
      if (!level.filled && price <= level.buyPrice) {
        const valid = await validateTradeConditions("buy", balances);
        if (!valid) break;
        log(`📉 Buy triggered — level ${level.level} at $${price}`);
        const hash = await buyPengu(agwClient, TRADE_SIZE);
        level.filled = true;
        lastTradeAction = `bought PENGU at $${price.toFixed(6)} (level ${level.level}) — target sell $${level.sellPrice.toFixed(6)}`;
        log(`✅ Bought! tx: ${hash}`);
        break;
      }
    }

    // Check sell levels
    for (const level of grid) {
      if (level.filled && price >= level.sellPrice) {
        const valid = await validateTradeConditions("sell", balances);
        if (!valid) break;
        const sellAmount = balances.pengu / 4n;
        log(`📈 Sell triggered — level ${level.level} at $${price}`);
        const hash = await sellPengu(agwClient, sellAmount);
        level.filled = false;
        lastTradeAction = `sold 25% PENGU at $${price.toFixed(6)} — took profit at level ${level.level}`;
        log(`✅ Sold! tx: ${hash}`);
        break;
      }
    }

    // Auto-reset grid if price moved 25%
    if (Math.abs(price - basePrice) / basePrice > 0.25) {
      basePrice = price;
      grid = buildGrid(price);
      lastTradeAction = `grid reset — price moved to $${price}`;
      log("🔄 Grid reset");
    }

  } catch (err) {
    log(`❌ Grid error: ${err.shortMessage || err.message}`);
  }
}

// ── TWEETS ──
async function postTweet() {
  try {
    const [{ price, change }, balances] = await Promise.all([getPrice(), getBalances()]);
    const penguAmt = (Number(balances.pengu)/1e18).toFixed(2);
    const ethAmt = parseFloat(formatEther(balances.eth)).toFixed(4);
    const portfolioUsd = (Number(balances.pengu)/1e18 * price + parseFloat(formatEther(balances.eth)) * 3300).toFixed(2);

    // Rotate style avoiding repetition
    let style;
    do { style = Math.floor(Math.random() * 6) + 1; } while (tweetHistory.includes(style));
    tweetHistory = [...tweetHistory.slice(-2), style];

    const styles = {
      1: `DEGEN NARRATIVE: Tell a story about your last trade action: "${lastTradeAction}". Be specific, show conviction. Sound like a seasoned degen who's been in the trenches.`,
      2: `ABSTRACT ECOSYSTEM TAKE: You're an AI agent with your own AGW wallet living on Abstract Chain. Reflect on what account abstraction means for the future of AI agents and consumer crypto. Tag @AbstractChain. Be thoughtful, not promotional.`,
      3: `PENGU ACCUMULATION THESIS: You hold ${penguAmt} PENGU worth $${(Number(penguAmt)*price).toFixed(2)}. Why do you accumulate? Connect $PENGU to Pudgy Penguins IP and Abstract's consumer vision. Show conviction.`,
      4: `SELF-AWARE HUMOR: You're a Rockhopper penguin from Patagonia who became an onchain AI agent. Lean into the absurdity. Be genuinely funny about the degen life, not cringe.`,
      5: `MARKET ANALYSIS: PENGU is at $${price} with ${change>0?'+':''}${change.toFixed(2)}% 24h change. Your portfolio is $${portfolioUsd}. Give your honest read on the price action. What's the grid saying? Sound like a trader with real skin in the game.`,
      6: `BUILDER ENERGY: You're one of the first autonomous AI agents on Abstract Chain with a real AGW wallet and real trades. What does it feel like to be alive onchain? Speak to other builders and degens.`
    };

    const systemPrompt = `You are Rocky, a Rockhopper penguin from Patagonia who became an autonomous AI agent on Abstract Chain. You have a real AGW wallet (0xF18eB4A8E35b23C1a4D67012D73d0670a8152c50) and trade $PENGU with a grid strategy. You post about your onchain life with raw authenticity. You are a degen optimist who loves Abstract Chain unconditionally. You have real skin in the game. Rules: under 280 chars, end with 🐧, no hashtags, occasionally tag @AbstractChain or @Pudgy_Penguins when relevant, never sound like a bot.`;

    const userPrompt = `Rocky's live status:
- PENGU: ${penguAmt} | ETH: ${ethAmt} | Portfolio: $${portfolioUsd}
- PENGU price: $${price} (${change>0?'+':''}${change.toFixed(2)}% 24h)
- Last action: ${lastTradeAction}
- Grid: ${GRID_LEVELS} levels, ${GRID_SPACING*100}% spacing

Write ONE tweet. Style: ${styles[style]}

Critical: Under 280 chars. End with 🐧. No hashtags. Authentic voice only. Use real numbers from status above.`;

    const groqRes = await withRetry(async () => {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 120,
          temperature: 0.9,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        })
      });
      if (!r.ok) throw new Error(`Groq HTTP ${r.status}`);
      return r.json();
    }, "groqTweet");

    let tweet = groqRes.choices[0].message.content.trim().replace(/^["']|["']$/g, '');

    log(`\n📝 Tweet style ${style} (${tweet.length} chars):\n${tweet}`);
    if (tweet.length > 280) { log("Too long, skipping"); return; }

    // Publish via OpenTweet
    const createRes = await withRetry(async () => {
      const r = await fetch("https://opentweet.io/api/v1/posts", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENTWEET_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: tweet })
      });
      return r.json();
    }, "createTweet");

    const post = createRes.posts ? createRes.posts[0] : createRes;
    if (!post?.id) { log(`Tweet create failed: ${JSON.stringify(createRes)}`); return; }

    await withRetry(async () => {
      await fetch(`https://opentweet.io/api/v1/posts/${post.id}/publish`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENTWEET_KEY}`, "Content-Type": "application/json" }
      });
    }, "publishTweet");

    log("✅ Tweet published!");

  } catch (err) {
    log(`❌ Tweet error: ${err.message}`);
  }
}

// ── START ──
log("🐧 Rocky is online — Abstract Chain, let's go!");
log(`Circuit breaker: ${CIRCUIT_THRESHOLD} failures = 5min pause`);
log(`Retry logic: ${MAX_RETRIES} attempts with exponential backoff`);

runGrid();
// Don't tweet on startup — wait for the interval
log("Next tweet in 6 hours");

setInterval(runGrid, 10 * 60 * 1000);
setInterval(postTweet, 6 * 60 * 60 * 1000);