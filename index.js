import { createPublicClient, http, parseEther, formatEther, encodePacked, encodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { abstract } from "viem/chains";
import { createAbstractClient } from "@abstract-foundation/agw-client";
import fetch from "node-fetch";

// Config
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENTWEET_KEY = process.env.OPENTWEET_KEY;
const AGW_ADDRESS = "0xF18eB4A8E35b23C1a4D67012D73d0670a8152c50";
const PENGU = "0x9eBe3A824Ca958e4b3Da772D2065518F009CBa62";
const WETH = "0x3439153EB7AF838Ad19d56E1571FBD09333C2809";
const ROUTER = "0xE1b076ea612Db28a0d768660e4D81346c02ED75e";
const PAIR = "0xda7d037fda848177141e037f9d0c67cae7b53262";
const ETH_RESERVE = parseEther("0.003");
const TRADE_SIZE = parseEther("0.0003");
const GRID_SPACING = 0.04;
const GRID_LEVELS = 5;

const PERSONALITY = `You are Rocky, a Rockhopper penguin from Patagonia who migrated to Abstract Chain. You have your own AGW wallet and actively trade $PENGU and interact with the Abstract ecosystem. You deeply understand ZK technology, account abstraction, Abstract Global Wallet, and the full Abstract ecosystem. You are a degen optimist. You love Abstract Chain unconditionally. Tweet under 280 chars, always end with 🐧, no hashtags, tag @AbstractChain when relevant.`;

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
const publicClient = createPublicClient({ chain: abstract, transport: http("https://api.mainnet.abs.xyz") });

// Grid state
let basePrice = null;
let grid = [];
let lastTradeAction = "waiting for first price check";

function buildGrid(price) {
  const levels = [];
  for (let i = 1; i <= GRID_LEVELS; i++) {
    levels.push({
      level: i,
      buyPrice: price * (1 - GRID_SPACING * i),
      sellPrice: price * (1 + GRID_SPACING * i),
      filled: false,
      penguBought: 0n
    });
  }
  return levels;
}

async function getPrice() {
  const r = await fetch(`https://api.dexscreener.com/latest/dex/pairs/abstract/${PAIR}`);
  const d = await r.json();
  return parseFloat(d.pair.priceUsd);
}

async function getBalances() {
  const eth = await publicClient.getBalance({ address: AGW_ADDRESS });
  const pengu = await publicClient.readContract({
    address: PENGU, abi: ERC20_ABI, functionName: "balanceOf", args: [AGW_ADDRESS]
  });
  return { eth, pengu };
}

async function buyPengu(agwClient, amount) {
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
}

async function sellPengu(agwClient, penguAmount) {
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
}

async function runGrid() {
  try {
    const agwClient = await createAbstractClient({
      signer: account, chain: abstract, transport: http("https://api.mainnet.abs.xyz")
    });

    const price = await getPrice();
    const balances = await getBalances();
    const ethFree = balances.eth - ETH_RESERVE;

    console.log(`🐧 Grid | ${new Date().toISOString()} | ETH: ${formatEther(balances.eth)} | PENGU: ${(Number(balances.pengu)/1e18).toFixed(2)} | Price: $${price}`);

    if (!basePrice) {
      basePrice = price;
      grid = buildGrid(price);
      lastTradeAction = `Grid initialized at $${price}`;
      console.log(lastTradeAction);
      return;
    }

    // Buy levels
    for (const level of grid) {
      if (!level.filled && price <= level.buyPrice && ethFree >= TRADE_SIZE) {
        console.log(`📉 Buying at level ${level.level} — price $${price}`);
        const hash = await buyPengu(agwClient, TRADE_SIZE);
        level.filled = true;
        lastTradeAction = `bought PENGU at $${price} (level ${level.level})`;
        console.log(`✅ Bought! tx: ${hash}`);
        break;
      }
    }

    // Sell levels
    for (const level of grid) {
      if (level.filled && price >= level.sellPrice) {
        const sellAmount = balances.pengu / 4n;
        if (sellAmount > 0n) {
          console.log(`📈 Selling at level ${level.level} — price $${price}`);
          const hash = await sellPengu(agwClient, sellAmount);
          level.filled = false;
          lastTradeAction = `sold PENGU at $${price} (level ${level.level})`;
          console.log(`✅ Sold! tx: ${hash}`);
        }
        break;
      }
    }

    // Reset grid if price moved 25%
    if (Math.abs(price - basePrice) / basePrice > 0.25) {
      basePrice = price;
      grid = buildGrid(price);
      lastTradeAction = `grid reset at $${price}`;
      console.log("🔄 Grid reset");
    }

  } catch (err) {
    console.error("Grid error:", err.shortMessage || err.message);
  }
}

async function postTweet() {
  try {
    const price = await getPrice();
    const balances = await getBalances();
    const penguAmount = (Number(balances.pengu)/1e18).toFixed(2);
    const ethAmount = formatEther(balances.eth);

    const context = `Rocky's current status: ${penguAmount} PENGU in wallet, ${ethAmount} ETH, PENGU price $${price}, last action: ${lastTradeAction}`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 100,
        messages: [
          { role: "system", content: PERSONALITY },
          { role: "user", content: `Rocky's onchain status: ${context}

You are Rocky. Generate ONE tweet. Rotate between these styles randomly:
1. DEGEN STORY: Tell a mini story about your trade — "bought the dip at $X, waiting for $Y, patience is a penguin virtue"
2. ABSTRACT ECOSYSTEM: Comment on Abstract Chain's vision — AGW, AI agents, consumer crypto, tag @AbstractChain
3. PENGU CONVICTION: Why you accumulate PENGU — connect to Pudgy Penguins IP, Abstract's future
4. HUMOR: Penguin from Patagonia trying to understand DeFi, self-aware degen humor
5. MARKET READ: Your take on current price action, grid levels, what you're watching

Rules: Under 280 chars. End with 🐧. No hashtags. Occasionally tag @AbstractChain or @Pudgy_Penguins. Never repeat the same style twice in a row. Sound like a real degen with personality, not a bot reporting numbers.` }
        ]
      })
    });
    const groqData = await groqRes.json();
    const tweet = groqData.choices[0].message.content.trim();
    console.log(`📝 Tweet (${tweet.length} chars): ${tweet}`);

    if (tweet.length > 280) return;

    const createRes = await fetch("https://opentweet.io/api/v1/posts", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENTWEET_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: tweet })
    });
    const createData = await createRes.json();
    const post = createData.posts ? createData.posts[0] : createData;
    if (!post?.id) { console.error("Tweet create failed:", createData); return; }

    await fetch(`https://opentweet.io/api/v1/posts/${post.id}/publish`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENTWEET_KEY}`, "Content-Type": "application/json" }
    });
    console.log("✅ Tweet published!");
  } catch (err) {
    console.error("Tweet error:", err.message);
  }
}

// Start
console.log("🐧 Rocky is online — Abstract Chain, let's go!");
runGrid();
postTweet();

setInterval(runGrid, 10 * 60 * 1000);    // Trade every 10 min
setInterval(postTweet, 6 * 60 * 60 * 1000); // Tweet every 6 hours