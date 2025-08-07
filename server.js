const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

const allowedOrigins = [
  "https://travdif.com",
  "https://www.travdif.com",
  "https://incomparable-heliotrope-f687a0.netlify.app",
  "http://localhost:3000"
];

// CORS configuration
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      return callback(new Error('CORS policy does not allow access from this origin'), false);
    }
    return callback(null, true);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.options("*", cors());
app.use(express.json());

// Initialize Google Gemini
let genAI;
let model;
let knowledgeBase = "";

// Performance tracking
let totalRequests = 0;
let totalCost = 0;

// Initialize Gemini and load knowledge base
async function initializeGemini() {
  try {
    console.log("🚀 Initializing Google Gemini...");
    
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    
    // Initialize Gemini
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    console.log("✅ Gemini API initialized successfully!");
    
    // Load knowledge base from file
    const knowledgePath = path.join(__dirname, "travdif_knowledge.txt");
    
    if (fs.existsSync(knowledgePath)) {
      knowledgeBase = fs.readFileSync(knowledgePath, "utf-8");
      console.log(`✅ Knowledge base loaded: ${knowledgeBase.length} characters`);
      console.log("📄 Knowledge preview:", knowledgeBase.substring(0, 100) + "...");
    } else {
      console.log("⚠️ travdif_knowledge.txt not found - using basic responses");
      knowledgeBase = `
      Travdif is a premium travel service company that offers:
      - Custom travel packages ✈️
      - Transparent pricing 💰
      - Personalized service 🎯
      - 24/7 customer support 📱
      - Destination planning 🗺️
      
      Contact us:
      - WhatsApp: Available 24/7
      - Instagram: @travdif
      - Website: https://travdif.com
      `;
    }
    
    console.log("🎉 Gemini setup complete! Ready to serve requests.");
    
  } catch (error) {
    console.error("❌ Gemini initialization failed:", error.message);
    throw error;
  }
}

// Smart response generator with knowledge base
async function generateResponse(userQuery) {
  try {
    const systemPrompt = `You are Zivy, an advanced AI assistant for Travdif travel services.

RESPONSE STYLE:
- Keep responses under 40 words when possible
- For longer responses, use engaging formats:
  • Bullet points with emojis (✨, 💰, 📱, 🔧, 🎯)  
  • Short, scannable paragraphs
  • Highlight key information
  • Use conversational, friendly tone
- Make content addictive and easy to read
- Always be helpful and professional

FORMATTING RULES:
- Use bullet points for lists
- Highlight prices and important info
- Break long text into digestible chunks
- Include relevant emojis for visual appeal

KNOWLEDGE BASE:
${knowledgeBase}

Answer the user's question about Travdif travel services using the knowledge base above. Be accurate and engaging.

User Question: ${userQuery}

Your Response:`;

    console.log("🤖 Sending request to Gemini...");
    
    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    const reply = response.text();
    
    // Estimate cost (Gemini 1.5 Flash pricing)
    const estimatedInputTokens = systemPrompt.length / 4;
    const estimatedOutputTokens = reply.length / 4;
    const estimatedCost = (estimatedInputTokens * 0.075 + estimatedOutputTokens * 0.30) / 1000000;
    totalCost += estimatedCost;
    
    console.log(`✅ Gemini response generated | Cost: ~$${estimatedCost.toFixed(6)}`);
    console.log(`📝 Response preview: "${reply.substring(0, 50)}..."`);
    
    return reply;
    
  } catch (error) {
    console.error("❌ Gemini API error:", error.message);
    throw error;
  }
}

// Main chat endpoint
app.post("/chat", async (req, res) => {
  try {
    totalRequests++;
    
    const messages = req.body.messages;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ 
        reply: "Invalid request format. 'messages' must be an array." 
      });
    }

    const userMessage = messages[messages.length - 1];
    if (!userMessage || userMessage.role !== 'user') {
      return res.status(400).json({ 
        reply: "Invalid message format." 
      });
    }

    const userQuery = userMessage.content;
    console.log(`📝 Processing query: "${userQuery.substring(0, 50)}..."`);

    // Generate response with Gemini
    const reply = await generateResponse(userQuery);
    
    res.json({ reply });

  } catch (error) {
    console.error("❌ Chat error:", error.message);
    
    // Fallback responses
    let fallbackReply = "Sorry, I'm having trouble right now. Please try again! 🔧";
    
    if (error.message.includes("API_KEY")) {
      fallbackReply = "Configuration issue. Please contact support! 🔧";
    } else if (error.message.includes("quota")) {
      fallbackReply = "Service temporarily unavailable. Please try again shortly! ⏳";
    }
    
    res.status(500).json({ reply: fallbackReply });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "Google Gemini",
    model: "gemini-1.5-flash",
    knowledge_loaded: knowledgeBase.length > 0,
    knowledge_size: `${knowledgeBase.length} characters`,
    stats: {
      total_requests: totalRequests,
      estimated_total_cost: `$${totalCost.toFixed(4)}`,
      avg_cost_per_request: totalRequests > 0 ? `$${(totalCost / totalRequests).toFixed(6)}` : "$0.000000"
    },
    api_ready: !!genAI
  });
});

// Performance stats endpoint
app.get("/stats", (req, res) => {
  res.json({
    service: "Google Gemini AI",
    model: "gemini-1.5-flash",
    performance: {
      total_requests: totalRequests,
      service_uptime: process.uptime(),
      avg_response_cost: totalRequests > 0 ? `$${(totalCost / totalRequests).toFixed(6)}` : "$0.000000"
    },
    cost_analysis: {
      estimated_total_cost: `$${totalCost.toFixed(4)}`,
      monthly_projection_1000_req: `$${(totalCost / Math.max(totalRequests, 1) * 1000).toFixed(2)}`,
      savings_vs_openai: "~95% cheaper than OpenAI GPT-4o"
    },
    knowledge_base: {
      loaded: knowledgeBase.length > 0,
      size_characters: knowledgeBase.length,
      size_kb: Math.round(knowledgeBase.length / 1024),
      last_updated: "On server restart"
    },
    benefits: [
      "95% cheaper than OpenAI",
      "Faster response times",
      "Knowledge base included in context",
      "No external file dependencies",
      "Simple and reliable"
    ]
  });
});

// Test endpoint
app.get("/test", (req, res) => {
  res.json({
    message: "🚀 Zivy with Google Gemini is working!",
    timestamp: new Date().toISOString(),
    service: "Google Gemini 1.5 Flash",
    environment: {
      gemini_api_ready: !!genAI,
      knowledge_base_loaded: knowledgeBase.length > 0,
      port: port
    },
    quick_test: "Send 'test' in chat to verify AI responses"
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "🎉 Zivy Backend - Powered by Google Gemini!",
    service: "Google Gemini 1.5 Flash",
    status: "ready",
    cost: "95% cheaper than OpenAI",
    endpoints: {
      chat: "POST /chat - Main chat endpoint",
      health: "GET /health - System health check",
      stats: "GET /stats - Performance analytics",
      test: "GET /test - Service test"
    }
  });
});

// Start server
async function startServer() {
  try {
    console.log("🚀 Starting Zivy backend with Google Gemini...");
    
    // Start server first
    app.listen(port, () => {
      console.log("🎉 ================================");
      console.log("🎉 Zivy Backend - Google Gemini");
      console.log("🎉 ================================");
      console.log(`✅ Server running on port ${port}`);
      console.log(`🌐 URL: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}`);
      console.log(`🤖 Service: Google Gemini 1.5 Flash`);
      console.log(`💰 Cost: 95% cheaper than OpenAI`);
      console.log(`🔍 Test: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}/test`);
      console.log(`💚 Health: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}/health`);
      console.log("🎉 ================================");
    });
    
    // Initialize Gemini in background
    initializeGemini().catch(error => {
      console.error("⚠️ Gemini initialization failed:", error.message);
      console.log("💡 Server running, but you need to set GEMINI_API_KEY");
    });
    
  } catch (error) {
    console.error("❌ Server startup failed:", error.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📊 Final Gemini stats:');
  console.log(`   Total requests: ${totalRequests}`);
  console.log(`   Total cost: $${totalCost.toFixed(4)}`);
  console.log(`   Savings vs OpenAI: ~${((1 - totalCost/50) * 100).toFixed(1)}%`);
  console.log('👋 Shutting down gracefully...');
  process.exit(0);
});

// Error handlers
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
  process.exit(1);
});

startServer();