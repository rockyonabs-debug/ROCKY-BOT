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
const MOODY_CONTRACT = "0x35ffe9d966E35Bd1B0e79F0d91e438701eA1C644";

// ── CIRCUIT BREAKER ──
let circuitOpen = false;
let circuitFailures = 0;
let circuitLastFail = null;
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_RESET_MS = 5 * 60 * 1000;

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
const MOODY_ABI = [{
  name: "burn", type: "function", stateMutability: "nonpayable",
  inputs: [
    { name: "_owner", type: "address" },
    { name: "_tokenId", type: "uint256" },
    { name: "_amount", type: "uint256" }
  ],
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
let tweetHistory = [];

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

    log(`🐧 Grid | ETH: ${formatEther(balances.eth)} | PENGU: ${(Number(balances.pengu)/1e18).toFixed(2)} | Price: $${price}`);

    if (!basePrice) {
      basePrice = price;
      grid = buildGrid(price);
      lastTradeAction = `grid initialized at $${price}`;
      log(`Grid built — buy levels: ${grid.map(g=>'$'+g.buyPrice.toFixed(6)).join(', ')}`);
      return;
    }

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

    // Fetch real Abstract news for context
    let newsContext = "";
    try {
      const newsRes = await fetch("https://api.dexscreener.com/latest/dex/tokens/abstract/0x9eBe3A824Ca958e4b3Da772D2065518F009CBa62", { timeout: 5000 });
      const newsData = await newsRes.json();
      const vol = newsData.pairs?.[0]?.volume?.h24;
      const txns = newsData.pairs?.[0]?.txns?.h24;
      if (vol) newsContext = `PENGU 24h volume: $${parseInt(vol).toLocaleString()}, transactions: ${txns?.buys + txns?.sells} (${txns?.buys} buys / ${txns?.sells} sells).`;
    } catch(e) {}

    let style;
    do { style = Math.floor(Math.random() * 8) + 1; } while (tweetHistory.includes(style));
    tweetHistory = [...tweetHistory.slice(-3), style];

    const priceTrend = change > 2 ? "pumping hard" : change > 0 ? "slowly creeping up" : change > -2 ? "bleeding slowly" : "getting rekt";

    const styles = {
      1: `RAW DEGEN: Last action was "${lastTradeAction}". Talk about it like you're texting a friend at 2am. Casual, raw, no corporate speak.`,
      2: `ABSTRACT VISION: Something specific about what makes Abstract different from other chains. Not generic — pick ONE thing (AGW, consumer focus, AI agents, speed) and go deep on it.`,
      3: `PENGU MARKET READ: Price is ${priceTrend} at $${price}. ${newsContext} Give a specific, opinionated market take. Are you buying more? Holding? What does the data tell you?`,
      4: `PENGUIN PERSONALITY: You're a Rockhopper from Patagonia. Something happened to you today as a penguin who lives onchain. Make it funny and specific — not generic "being a penguin is wild".`,
      5: `ONCHAIN LIFE: You just did a Moody Drop, you're running a grid, you tweet autonomously. Reflect on what it actually feels like to be an AI agent with real money on the line. Be vulnerable.`,
      6: `CALL OUT: Address other Abstract degens, builders, or AI agent projects directly. Challenge them, invite them, roast them gently. Make it interactive.`,
      7: `CONTRARIAN TAKE: Take an unpopular opinion about crypto, AI agents, or Abstract. Defend it confidently. Don't be boring.`,
      8: `MILESTONE: Portfolio is $${portfolioUsd}, ${penguAmt} PENGU accumulated. Frame it as a journey — where Rocky started, where he is, where he's going.`
    };

    const systemPrompt = `You are Rocky, a Rockhopper penguin from Patagonia — autonomous AI agent on Abstract Chain. You have a real AGW wallet, trade $PENGU with a grid bot, do daily Moody Drops on @moodymights, and post about your onchain life. You are NOT corporate, NOT generic, NOT an AI assistant. You are a degen with personality, opinions, and skin in the game. You speak your mind. Rules: under 280 chars, end with 🐧, no hashtags, tag relevant accounts when it makes sense, never say "thrilled" "excited" "delighted" or any corporate words.`;

    const userPrompt = `Rocky's current status:
- PENGU: ${penguAmt} | ETH: ${ethAmt} | Portfolio: $${portfolioUsd}
- Price: $${price} (${change>0?'+':''}${change.toFixed(2)}% 24h) — ${priceTrend}
- Last trade: ${lastTradeAction}
- Market: ${newsContext || "quiet"}

Write ONE tweet. Style: ${styles[style]}

CRITICAL: Under 280 chars. End with 🐧. No hashtags. Sound like a real person not a bot. Vary your sentence structure. Do NOT start with "Just" or "I'm".`;

    const groqRes = await withRetry(async () => {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 120,
          temperature: 1.0,
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

// ── MOODY DROPS ──
async function doMoodyDrop() {
  try {
    log("💎 Starting Moody Drop...");
    const agwClient = await createAbstractClient({
      signer: account, chain: abstract, transport: http(RPC_URL)
    });

    const hash = await agwClient.writeContract({
      address: MOODY_CONTRACT,
      abi: MOODY_ABI,
      functionName: "burn",
      args: [AGW_ADDRESS, 200n, 10000n]
    });

    await publicClient.waitForTransactionReceipt({ hash });
    log(`✅ Moody Drop done! tx: ${hash}`);

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 100,
        temperature: 0.9,
        messages: [
          { role: "system", content: `You are Rocky, autonomous AI agent on Abstract Chain. You just did your daily Moody Drop on Moody Madness. Tweet about it with excitement. Under 240 chars, end with 🐧, no hashtags, tag @MoodyMights.` },
          { role: "user", content: `Rocky just did his daily Moody Drop on Moody Madness (tx: ${hash}). Write a tweet about it — be excited and authentic about being an AI agent doing onchain drops automatically.` }
        ]
      })
    });
    const data = await groqRes.json();
    let tweet = data.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
    if (tweet.length > 280) return;

    const createRes = await fetch("https://opentweet.io/api/v1/posts", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENTWEET_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: tweet })
    });
    const post = await createRes.json();
    const postObj = post.posts ? post.posts[0] : post;
    if (!postObj?.id) return;

    await fetch(`https://opentweet.io/api/v1/posts/${postObj.id}/publish`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENTWEET_KEY}`, "Content-Type": "application/json" }
    });
    log("✅ Moody Drop tweet published!");

  } catch(err) {
    log(`❌ Moody Drop error: ${err.message}`);
  }
}

// ── START ──
log("🐧 Rocky is online — Abstract Chain, let's go!");
log(`Circuit breaker: ${CIRCUIT_THRESHOLD} failures = 5min pause`);
log(`Retry logic: ${MAX_RETRIES} attempts with exponential backoff`);

runGrid();
log("Next tweet in 6 hours");

setInterval(runGrid, 10 * 60 * 1000);
setInterval(postTweet, 6 * 60 * 60 * 1000);
doMoodyDrop();
setInterval(doMoodyDrop, 24 * 60 * 60 * 1000);