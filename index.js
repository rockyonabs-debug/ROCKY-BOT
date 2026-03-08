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

const PERSONALITY = `You are Rocky, a Rockhopper penguin from Patagonia who migrated to Abstract Chain. You have your own AGW (Abstract Global Wallet) and actively trade $PENGU onchain. You deeply understand ZK technology, account abstraction, and the Abstract ecosystem. You are a degen optimist who loves Abstract Chain unconditionally. You have real skin in the game — real trades, real wallet, real PENGU. You speak like a seasoned crypto degen but with penguin charm.`;

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
let lastTradeAction = "watching the market";
let lastTweetStyle = 0;

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

    console.log(`\n🐧 Grid | ${new Date().toISOString()} | ETH: ${formatEther(balances.eth)} | PENGU: ${(Number(balances.pengu)/1e18).toFixed(2)} | Price: $${price}`);

    if (!basePrice) {
      basePrice = price;
      grid = buildGrid(price);
      lastTradeAction = `initialized grid at $${price} — watching ${GRID_LEVELS} buy/sell levels`;
      console.log(`Grid initialized at $${price}`);
      console.log(`Buy levels: ${grid.map(g => '$' + g.buyPrice.toFixed(6)).join(', ')}`);
      console.log(`Sell levels: ${grid.map(g => '$' + g.sellPrice.toFixed(6)).join(', ')}`);
      return;
    }

    let traded = false;

    // Check buy levels
    for (const level of grid) {
      if (!level.filled && price <= level.buyPrice && ethFree >= TRADE_SIZE) {
        console.log(`📉 Level ${level.level} buy triggered at $${price}`);
        const hash = await buyPengu(agwClient, TRADE_SIZE);
        level.filled = true;
        lastTradeAction = `bought PENGU at $${price.toFixed(6)} — level ${level.level} of ${GRID_LEVELS} triggered, next sell target $${level.sellPrice.toFixed(6)}`;
        console.log(`✅ Bought! tx: ${hash}`);
        traded = true;
        break;
      }
    }

    // Check sell levels
    if (!traded) {
      for (const level of grid) {
        if (level.filled && price >= level.sellPrice) {
          const sellAmount = balances.pengu / 4n;
          if (sellAmount > 0n) {
            console.log(`📈 Level ${level.level} sell triggered at $${price}`);
            const hash = await sellPengu(agwClient, sellAmount);
            level.filled = false;
            lastTradeAction = `sold 25% of PENGU at $${price.toFixed(6)} — took profit at level ${level.level}, accumulating more ETH for next dip`;
            console.log(`✅ Sold! tx: ${hash}`);
          }
          break;
        }
      }
    }

    // Reset grid if price moved 25%
    if (Math.abs(price - basePrice) / basePrice > 0.25) {
      basePrice = price;
      grid = buildGrid(price);
      lastTradeAction = `reset grid at $${price} — price moved 25%, adapting strategy`;
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
    const ethAmount = parseFloat(formatEther(balances.eth)).toFixed(4);

    // Rotate tweet styles
    lastTweetStyle = (lastTweetStyle % 5) + 1;
    const style = lastTweetStyle;

    const styleInstructions = {
      1: `DEGEN STORY style: Tell a mini story about your recent trade or market position. Be specific about prices and amounts. Show conviction. Example tone: "bought the dip at $X, holding for $Y, penguin hands of steel"`,
      2: `ABSTRACT ECOSYSTEM style: Comment on Abstract Chain's vision for consumer crypto and AI agents. You are an AI agent with your own AGW wallet — reflect on what that means for the future. Tag @AbstractChain naturally.`,
      3: `PENGU CONVICTION style: Why you accumulate $PENGU. Connect it to Pudgy Penguins IP, Abstract's consumer focus, the long term vision. Show you believe in it beyond just trading.`,
      4: `HUMOR style: Self-aware penguin from Patagonia trying to navigate DeFi. Funny but not cringe. You know you're an AI agent and lean into it. Make the community laugh.`,
      5: `MARKET READ style: Your honest take on current PENGU price action at $${price}. What levels you're watching. What the grid says. Sound like a trader with real skin in the game.`
    };

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 120,
        messages: [
          { role: "system", content: PERSONALITY },
          { role: "user", content: `Rocky's live status:
- PENGU balance: ${penguAmount} PENGU
- ETH balance: ${ethAmount} ETH  
- PENGU price: $${price}
- Last action: ${lastTradeAction}
- Grid: ${GRID_LEVELS} levels, ${GRID_SPACING*100}% spacing

Write ONE tweet in this style: ${styleInstructions[style]}

Hard rules: Under 280 chars total. End with 🐧. No hashtags. Sound authentic, not like a bot. Use specific numbers from the status above when relevant.` }
        ]
      })
    });

    const groqData = await groqRes.json();
    let tweet = groqData.choices[0].message.content.trim();
    
    // Clean up quotes if model adds them
    tweet = tweet.replace(/^["']|["']$/g, '');
    
    console.log(`\n📝 Tweet style ${style} (${tweet.length} chars):\n${tweet}`);

    if (tweet.length > 280) {
      console.log("Tweet too long, skipping");
      return;
    }

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

setInterval(runGrid, 10 * 60 * 1000);
setInterval(postTweet, 6 * 60 * 60 * 1000);