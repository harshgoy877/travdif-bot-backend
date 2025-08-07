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
    
    // Initialize Gemini with correct model name
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // Correct Gemini model names (these are the actual API names)
    const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp"; 
    // Available models:
    // - "gemini-1.5-flash-latest" (fastest, cheapest)
    // - "gemini-1.5-pro-latest" (more powerful)
    // - "gemini-2.0-flash-exp" (experimental Gemini 2.0)
    
    model = genAI.getGenerativeModel({ model: modelName });
    
    console.log(`✅ Gemini API initialized with model: ${modelName}`);
    
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
      
      We specialize in creating unforgettable travel experiences with complete transparency in pricing and personalized attention to every detail of your journey.
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
    
    // Estimate cost (Gemini pricing - very cheap!)
    const estimatedInputTokens = systemPrompt.length / 4;
    const estimatedOutputTokens = reply.length / 4;
    // Gemini 1.5 Flash: $0.075 input, $0.30 output per 1M tokens
    const estimatedCost = (estimatedInputTokens * 0.075 + estimatedOutputTokens * 0.30) / 1000000;
    totalCost += estimatedCost;
    
    console.log(`✅ Gemini response generated | Cost: ~$${estimatedCost.toFixed(6)}`);
    console.log(`📝 Response preview: "${reply.substring(0, 50)}..."`);
    
    return reply;
    
  } catch (error) {
    console.error("❌ Gemini API error:", error);
    
    // Better error handling
    if (error.message.includes('API_KEY')) {
      throw new Error("Invalid Gemini API key");
    } else if (error.message.includes('quota')) {
      throw new Error("Gemini API quota exceeded");
    } else if (error.message.includes('model')) {
      throw new Error("Gemini model not available");
    }
    
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

    // Check if Gemini is initialized
    if (!model) {
      console.log("⚠️ Gemini not ready, initializing...");
      await initializeGemini();
    }

    // Generate response with Gemini
    const reply = await generateResponse(userQuery);
    
    res.json({ reply });

  } catch (error) {
    console.error("❌ Chat error:", error.message);
    
    // Intelligent fallback responses
    let fallbackReply = "Sorry, I'm having trouble right now. Please try again! 🔧";
    
    if (error.message.includes("API key")) {
      fallbackReply = "Configuration issue. Please contact support! 🔧";
    } else if (error.message.includes("quota")) {
      fallbackReply = "Service temporarily busy. Please try again in a moment! ⏳";
    } else if (error.message.includes("model")) {
      fallbackReply = "AI service updating. Please try again shortly! 🔄";
    }
    
    res.status(500).json({ reply: fallbackReply });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  
  res.json({
    status: "healthy",
    service: "Google Gemini",
    model: modelName,
    knowledge_loaded: knowledgeBase.length > 0,
    knowledge_size: `${knowledgeBase.length} characters`,
    stats: {
      total_requests: totalRequests,
      estimated_total_cost: `$${totalCost.toFixed(4)}`,
      avg_cost_per_request: totalRequests > 0 ? `$${(totalCost / totalRequests).toFixed(6)}` : "$0.000000"
    },
    api_ready: !!genAI && !!model
  });
});

// Performance stats endpoint
app.get("/stats", (req, res) => {
  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  
  res.json({
    service: "Google Gemini AI",
    model: modelName,
    performance: {
      total_requests: totalRequests,
      service_uptime: Math.floor(process.uptime()),
      avg_response_cost: totalRequests > 0 ? `$${(totalCost / totalRequests).toFixed(6)}` : "$0.000000"
    },
    cost_analysis: {
      estimated_total_cost: `$${totalCost.toFixed(4)}`,
      monthly_projection_1000_req: `$${(totalCost / Math.max(totalRequests, 1) * 1000).toFixed(2)}`,
      savings_vs_openai: "~95% cheaper than OpenAI GPT-4"
    },
    knowledge_base: {
      loaded: knowledgeBase.length > 0,
      size_characters: knowledgeBase.length,
      size_kb: Math.round(knowledgeBase.length / 1024),
      last_updated: "On server restart"
    },
    available_models: [
      "gemini-1.5-flash-latest (default - fastest, cheapest)",
      "gemini-1.5-pro-latest (more powerful)",
      "gemini-2.0-flash-exp (experimental Gemini 2.0)"
    ],
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
  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  
  res.json({
    message: "🚀 Zivy with Google Gemini is working!",
    timestamp: new Date().toISOString(),
    service: `Google Gemini (${modelName})`,
    environment: {
      gemini_api_ready: !!genAI && !!model,
      knowledge_base_loaded: knowledgeBase.length > 0,
      model_configured: modelName,
      port: port
    },
    quick_test: "Send any message in chat to verify AI responses"
  });
});

// Model switching endpoint (for advanced users)
app.post("/admin/switch-model", async (req, res) => {
  try {
    const { model: newModel } = req.body;
    const validModels = [
      "gemini-1.5-flash-latest",
      "gemini-1.5-pro-latest", 
      "gemini-2.0-flash"
    ];
    
    if (!validModels.includes(newModel)) {
      return res.status(400).json({
        error: "Invalid model",
        valid_models: validModels
      });
    }
    
    // Re-initialize with new model
    model = genAI.getGenerativeModel({ model: newModel });
    console.log(`🔄 Switched to model: ${newModel}`);
    
    res.json({
      success: true,
      message: `Switched to ${newModel}`,
      previous_model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      new_model: newModel
    });
    
  } catch (error) {
    res.status(500).json({
      error: "Failed to switch model",
      message: error.message
    });
  }
});

// Root endpoint
app.get("/", (req, res) => {
  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  
  res.json({
    message: "🎉 Zivy Backend - Powered by Google Gemini!",
    service: `Google Gemini (${modelName})`,
    status: "ready",
    cost: "95% cheaper than OpenAI",
    endpoints: {
      chat: "POST /chat - Main chat endpoint",
      health: "GET /health - System health check",
      stats: "GET /stats - Performance analytics",
      test: "GET /test - Service test",
      switch_model: "POST /admin/switch-model - Change AI model"
    }
  });
});

// Start server
async function startServer() {
  try {
    console.log("🚀 Starting Zivy backend with Google Gemini...");
    
    // Start server first
    app.listen(port, () => {
      const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
      
      console.log("🎉 ================================");
      console.log("🎉 Zivy Backend - Google Gemini");
      console.log("🎉 ================================");
      console.log(`✅ Server running on port ${port}`);
      console.log(`🌐 URL: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}`);
      console.log(`🤖 Model: ${modelName}`);
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
  console.log(`   Savings vs OpenAI: ~95%`);
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