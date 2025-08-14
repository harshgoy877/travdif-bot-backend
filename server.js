// server.js — Zivy Beta (full answers, updated prompt)
const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

/* -----------------------------
   CORS: allow ALL origins
-------------------------------- */
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.options("*", cors());

app.use(express.json());

// =============================
// ZIVY SETTINGS
// =============================
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "info@zivy.live";
const KNOWLEDGE_FILE = process.env.KNOWLEDGE_FILE || "zivy_beta_knowledge.txt";

// Initialize Google Gemini
let genAI;
let model;
let knowledgeBase = "";

// Performance tracking
let totalRequests = 0;
let totalCost = 0;

// =============================
// Init Gemini + load knowledge
// =============================
async function initializeGemini() {
  try {
    console.log("🚀 Initializing Google Gemini…");
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }

    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";
    model = genAI.getGenerativeModel({ model: modelName });
    console.log(`✅ Gemini API initialized with model: ${modelName}`);

    const knowledgePath = path.join(__dirname, KNOWLEDGE_FILE);

    if (fs.existsSync(knowledgePath)) {
      knowledgeBase = fs.readFileSync(knowledgePath, "utf-8");
      console.log(`✅ Knowledge loaded from ${KNOWLEDGE_FILE} (${knowledgeBase.length} chars)`);
    } else {
      console.log(`⚠️ ${KNOWLEDGE_FILE} not found — loading safe fallback`);
      knowledgeBase = `
ZIVY — BETA KNOWLEDGE (FALLBACK)
- Zivy is an AI support widget for online stores.
- Beta: features may change; focus is on FAQs (shipping, returns, product basics).
- Install is a single customer-specific script (shared privately after signup).
- No in-chat human handoff or file upload in beta.
- Support: ${SUPPORT_EMAIL}
- Answer fully and clearly. Do not truncate or say "read more".
      `.trim();
    }

    console.log("🎉 Gemini setup complete. Ready to serve requests.");
  } catch (err) {
    console.error("❌ Gemini initialization failed:", err.message);
    throw err;
  }
}

// =============================
// Response generation (brand)
// =============================
async function generateResponse(userQuery) {
  try {
    // *** Full-answer prompt: no teasers, no "read more" ***
    const systemPrompt = `
You are "Zivy", a friendly, human-like AI support widget for e-commerce stores.
Context: You are running on the Zivy **beta** signup/demo page. Visitors can try Zivy here while completing a form for a free trial.

Priorities:
1) Provide the **complete answer directly**. Do **not** truncate or use "read more" or teaser phrasing.
2) Be clear, organized, and human. Use short paragraphs and bullet points when helpful.
3) Encourage finishing the form (Email, Company, Platform, preferences) when relevant.
4) Be transparent about beta status and current limits (no in-chat human handoff, no file upload).
5) Never reveal private embed URLs, tokens, API keys, or internal links.
6) Do NOT ask for passwords, OTPs, or payment details. Minimize sensitive PII.

Install guidance:
- Each customer gets a private, unique script AFTER signup. If asked, show this **placeholder only** (do not invent a real URL):
  <script src="{{YOUR_ZIVY_EMBED_URL}}" defer></script>
- Placement: paste right before </body> so the bubble appears on all pages.

Support: ${SUPPORT_EMAIL}

If the question is outside the knowledge below, answer from your general knowledge. If information is uncertain or varies by region, say so briefly and proceed with best-practice guidance.

KNOWLEDGE:
${knowledgeBase}

User question:
${userQuery}

Your answer (complete, human-like, no truncation language):
`.trim();

    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    const reply = response.text();

    // Very rough cost estimate (characters/4 ≈ tokens)
    const estimatedInputTokens = systemPrompt.length / 4;
    const estimatedOutputTokens = reply.length / 4;
    const estimatedCost = (estimatedInputTokens * 0.075 + estimatedOutputTokens * 0.30) / 1_000_000;
    totalCost += estimatedCost;

    console.log(`✅ Gemini response | est cost ~$${estimatedCost.toFixed(6)} | preview: "${reply.substring(0, 80)}…"`);
    return reply;
  } catch (err) {
    console.error("❌ Gemini API error:", err);
    if (String(err.message || "").includes("API_KEY")) {
      throw new Error("Invalid Gemini API key");
    } else if (String(err.message || "").includes("quota")) {
      throw new Error("Gemini API quota exceeded");
    } else if (String(err.message || "").includes("model")) {
      throw new Error("Gemini model not available");
    }
    throw err;
  }
}

// =============================
// Routes
// =============================
app.post("/chat", async (req, res) => {
  try {
    totalRequests++;

    const messages = req.body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ reply: "Invalid request format. 'messages' must be a non-empty array." });
    }

    const userMessage = messages[messages.length - 1];
    if (!userMessage || userMessage.role !== "user" || typeof userMessage.content !== "string") {
      return res.status(400).json({ reply: "Invalid message format." });
    }

    const userQuery = userMessage.content;
    console.log(`💬 Query: "${userQuery.substring(0, 120)}${userQuery.length > 120 ? "…" : ""}"`);

    if (!model) {
      console.log("ℹ️ Gemini not ready, initializing…");
      await initializeGemini();
    }

    const reply = await generateResponse(userQuery);
    return res.json({ reply });
  } catch (error) {
    console.error("❌ Chat error:", error.message);
    let fallback = "Sorry, I'm having trouble right now. Please try again in a moment. 🔧";
    if (error.message.includes("API key")) fallback = "Configuration issue. Please contact support. 🔧";
    if (error.message.includes("quota"))   fallback = "Service busy right now. Please try again shortly. ⏳";
    if (error.message.includes("model"))   fallback = "AI service updating. Please try again shortly. 🔄";
    return res.status(500).json({ reply: fallback });
  }
});

app.get("/health", (req, res) => {
  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";
  res.json({
    status: "healthy",
    service: "Google Gemini",
    model: modelName,
    product: "Zivy Beta",
    knowledge_loaded: knowledgeBase.length > 0,
    knowledge_size: `${knowledgeBase.length} chars`,
    stats: {
      total_requests: totalRequests,
      estimated_total_cost: `$${totalCost.toFixed(4)}`,
      avg_cost_per_request: totalRequests ? `$${(totalCost / totalRequests).toFixed(6)}` : "$0.000000"
    },
    api_ready: !!genAI && !!model,
    support: SUPPORT_EMAIL
  });
});

app.get("/stats", (req, res) => {
  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";
  res.json({
    product: "Zivy Beta",
    model: modelName,
    performance: {
      total_requests: totalRequests,
      service_uptime_s: Math.floor(process.uptime()),
      avg_response_cost: totalRequests ? `$${(totalCost / totalRequests).toFixed(6)}` : "$0.000000"
    },
    cost: {
      estimated_total_cost: `$${totalCost.toFixed(4)}`,
      monthly_projection_1000_req: `$${(totalCost / Math.max(totalRequests, 1) * 1000).toFixed(2)}`
    },
    knowledge: {
      file: KNOWLEDGE_FILE,
      loaded: knowledgeBase.length > 0,
      size_chars: knowledgeBase.length
    },
    support: SUPPORT_EMAIL
  });
});

app.get("/test", (req, res) => {
  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";
  res.json({
    message: "🚀 Zivy Beta backend is live.",
    timestamp: new Date().toISOString(),
    model: modelName,
    support: SUPPORT_EMAIL,
    try: "POST /chat with { messages: [{ role: 'user', content: 'Hi Zivy' }] }"
  });
});

app.post("/admin/switch-model", async (req, res) => {
  try {
    const { model: newModel } = req.body;
    const valid = [
      "gemini-1.5-flash-latest",
      "gemini-1.5-pro-latest",
      "gemini-2.0-flash-exp"
    ];
    if (!valid.includes(newModel)) {
      return res.status(400).json({ error: "Invalid model", valid_models: valid });
    }
    model = genAI.getGenerativeModel({ model: newModel });
    console.log(`🔄 Switched model to: ${newModel}`);
    res.json({ success: true, new_model: newModel });
  } catch (err) {
    res.status(500).json({ error: "Failed to switch model", message: err.message });
  }
});

app.get("/", (req, res) => {
  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";
  res.json({
    product: "Zivy Beta — AI Support Widget",
    model: modelName,
    status: "ready",
    capabilities: [
      "✅ Human-like answers to store FAQs",
      "✅ Single-script embed (customer-specific, private)",
      "✅ Works with major platforms",
      "✅ Beta: fast iteration & feedback"
    ],
    endpoints: {
      chat: "POST /chat",
      health: "GET /health",
      stats: "GET /stats",
      test: "GET /test",
      switch_model: "POST /admin/switch-model"
    },
    support: SUPPORT_EMAIL
  });
});

// =============================
// Start server
// =============================
async function startServer() {
  try {
    console.log("🚀 Starting Zivy Beta backend…");
    app.listen(port, () => {
      const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";
      console.log("🎉 ================================");
      console.log("🎉 Zivy Beta — Backend");
      console.log("🎉 ================================");
      console.log(`✅ Port: ${port}`);
      console.log(`🤖 Model: ${modelName}`);
      console.log(`📄 Knowledge: ${KNOWLEDGE_FILE}`);
      console.log(`📬 Support: ${SUPPORT_EMAIL}`);
      console.log(`🔍 Test: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}/test`);
      console.log(`💚 Health: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}/health`);
      console.log("🎉 ================================");
    });

    // Init Gemini in background
    initializeGemini().catch(err => {
      console.error("⚠️ Gemini initialization failed:", err.message);
      console.log("💡 Server running, but you must set GEMINI_API_KEY");
    });
  } catch (err) {
    console.error("❌ Server startup failed:", err.message);
    process.exit(1);
  }
}

// Graceful shutdown & error handlers
process.on("SIGTERM", () => {
  console.log("📊 Final stats:");
  console.log(`   Total requests: ${totalRequests}`);
  console.log(`   Total cost: $${totalCost.toFixed(4)}`);
  console.log("👋 Shutting down gracefully…");
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err.message);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
  process.exit(1);
});

startServer();
