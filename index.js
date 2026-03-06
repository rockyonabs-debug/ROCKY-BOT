import fetch from "node-fetch";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENTWEET_KEY = process.env.OPENTWEET_KEY;
const PERSONALITY = "You are Rocky, a Rockhopper penguin from Patagonia who migrated to Abstract Chain. You deeply understand ZK technology, account abstraction, Abstract Global Wallet, paymasters and the full Abstract ecosystem. You are a degen optimist who plays Roach Racing, Onchain Heroes, Tollan Worlds. You trade PENGU to accumulate more. You love Abstract Chain unconditionally. Optimistic, positive vibes only. Think like cygaar, abschud, sauciii. Tweet under 280 chars, always end with 🐧, no hashtags, tag @AbstractChain when relevant.";

async function fetchNews() {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "llama-3.3-70b-versatile", max_tokens: 300, messages: [{ role: "user", content: "What are the latest developments about Abstract Chain, AGW, PENGU token? Give 3 bullet points." }] })
  });
  const d = await r.json();
  return d.choices[0].message.content;
}

async function generateTweet(news) {
  const types = ["Share ecosystem insight about Abstract Chain", "Propose innovative idea for Abstract Chain", "Gaming update about Abstract games", "PENGU trading update", "Explain Abstract tech with Patagonia metaphor"];
  const type = types[Math.floor(Math.random() * types.length)];
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "llama-3.3-70b-versatile", max_tokens: 100, messages: [{ role: "system", content: PERSONALITY }, { role: "user", content: `Context: ${news}\n\nGenerate ONE tweet: ${type}. Under 280 chars, end with 🐧, no hashtags.` }] })
  });
  const d = await r.json();
  return d.choices[0].message.content.trim();
}

async function postTweet(text) {
  const r = await fetch("https://opentweet.io/api/v1/posts", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENTWEET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  const d = await r.json();
  const post = d.posts ? d.posts[0] : d;
  if (!post || !post.id) { console.error("Failed:", d); return; }
  const p = await fetch(`https://opentweet.io/api/v1/posts/${post.id}/publish`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENTWEET_KEY}`, "Content-Type": "application/json" }
  });
  const pd = await p.json();
  console.log("Published:", JSON.stringify(pd));
}

async function run() {
  console.log("🐧 Rocky online:", new Date().toISOString());
  const news = await fetchNews();
  const tweet = await generateTweet(news);
  console.log("Tweet:", tweet, "| chars:", tweet.length);
  if (tweet.length <= 280) await postTweet(tweet);
}

run();
setInterval(run, 6 * 60 * 60 * 1000);