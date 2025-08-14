const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

/* -----------------------------
   CORS: allow ALL origins
   (good for testing/demo; tighten later if needed)
-------------------------------- */
app.use(cors({
  origin: "*",
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
    
    // ✅ fixed: existsSync (was existsExists)
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

// Enhanced response generator with smart routing
async function generateResponse(userQuery) {
  try {
    // Check if question is travel/Travdif related
    const travelKeywords = [
      'travdif', 'travel', 'trip', 'vacation', 'holiday', 'booking', 'package', 
      'destination', 'flight', 'hotel', 'tour', 'journey', 'itinerary', 'price', 
      'cost', 'quote', 'contact', 'whatsapp', 'instagram', 'service'
    ];
    
    const queryLower = userQuery.toLowerCase();
    const isTravelRelated = travelKeywords.some(keyword => queryLower.includes(keyword));
    
    let systemPrompt;
    
    if (isTravelRelated) {
      // Travel-related: Use Travdif knowledge base first
      systemPrompt = `You are Zivy, an advanced AI assistant for Travdif travel services.

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

TRAVDIF KNOWLEDGE BASE:
${knowledgeBase}

INSTRUCTIONS:
1. First, check if the question can be answered using the Travdif knowledge base above
2. If it's about Travdif services, pricing, contact, or travel packages - use the knowledge base
3. If it's general travel advice, use your broader knowledge but mention Travdif when relevant
4. Always be helpful and engaging

User Question: ${userQuery}

Your Response:`;
    } else {
      // General question: Answer broadly but introduce yourself as Zivy from Travdif
      systemPrompt = `You are Zivy, an AI assistant. While I specialize in helping with Travdif travel services, I'm happy to help with any question you have!

RESPONSE STYLE:
- Keep responses under 40 words when possible
- For longer responses, use engaging formats:
  • Bullet points with emojis (✨, 💰, 📱, 🔧, 🎯)
  • Short, scannable paragraphs
  • Use conversational, friendly tone
- Always be helpful and professional

INSTRUCTIONS:
1. Answer the user's question using your general knowledge
2. Be accurate and helpful
3. If the topic could relate to travel, briefly mention that I also help with Travdif travel services
4. Use emojis and friendly tone

User Question: ${userQuery}

Your Response:`;
    }

    console.log(`🤖 Processing ${isTravelRelated ? 'TRAVEL-RELATED' : 'GENERAL'} query...`);
    console.log("🤖 Sending request to Gemini...");
    
    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    const reply = response.text();
    
    // Estimate cost (very rough)
    const estimatedInputTokens = systemPrompt.length / 4;
    const estimatedOutputTokens = reply.length / 4;
    // Gemini 2.0 Flash: similar pricing to 1.5 Flash
    const estimatedCost = (estimatedInputTokens * 0.075 + estimatedOutputTokens * 0.30) / 1_000_000;
    totalCost += estimatedCost;
    
    console.log(`✅ Gemini response generated | Type: ${isTravelRelated ? 'Travel' : 'General'} | Cost: ~$${estimatedCost.toFixed(6)}`);
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

    // Generate response with smart routing
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
  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";
  
  res.json({
    status: "healthy",
    service: "Google Gemini",
    model: modelName,
    mode: "Smart Routing (Travdif + General Knowledge)",
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
  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";
  
  res.json({
    service: "Google Gemini AI",
    model: modelName,
    mode: "Smart Routing System",
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
    routing_system: {
      travel_keywords: ["travdif", "travel", "trip", "vacation", "holiday", "booking", "package", "destination", "flight", "hotel", "tour", "journey", "itinerary", "price", "cost", "quote", "contact", "whatsapp", "instagram", "service"],
      logic: "Travel-related questions use Travdif knowledge base, general questions use broader AI knowledge"
    },
    available_models: [
      "gemini-1.5-flash-latest (fastest, cheapest)",
      "gemini-1.5-pro-latest (more powerful)",
      "gemini-2.0-flash-exp (latest Gemini 2.0)"
    ],
    benefits: [
      "Answers ANY question (not just travel)",
      "Prioritizes Travdif knowledge for travel queries",
      "95% cheaper than OpenAI",
      "Faster response times",
      "Smart question routing",
      "No external file dependencies"
    ]
  });
});

// Test endpoint
app.get("/test", (req, res) => {
  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";
  
  res.json({
    message: "🚀 Zivy with Smart Routing - Ready for ANY question!",
    timestamp: new Date().toISOString(),
    service: `Google Gemini (${modelName})`,
    mode: "Smart Routing: Travdif Knowledge + General AI",
    environment: {
      gemini_api_ready: !!genAI && !!model,
      knowledge_base_loaded: knowledgeBase.length > 0,
      model_configured: modelName,
      port: port
    },
    test_examples: {
      travel_question: "Ask about Travdif services, travel packages, or destinations",
      general_question: "Ask about anything - cooking, technology, history, science, etc.",
      routing: "Travel questions use Travdif knowledge, others use general AI knowledge"
    }
  });
});

// Model switching endpoint (for advanced users)
app.post("/admin/switch-model", async (req, res) => {
  try {
    const { model: newModel } = req.body;
    const validModels = [
      "gemini-1.5-flash-latest",
      "gemini-1.5-pro-latest", 
      "gemini-2.0-flash-exp"
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
      previous_model: process.env.GEMINI_MODEL || "gemini-2.0-flash-exp",
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
  const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";
  
  res.json({
    message: "🎉 Zivy Backend - Smart AI Assistant!",
    service: `Google Gemini (${modelName})`,
    mode: "Smart Routing: Travdif Knowledge + General AI",
    status: "ready",
    cost: "95% cheaper than OpenAI",
    capabilities: [
      "✅ Travdif travel services (priority)",
      "✅ General knowledge questions",
      "✅ Smart question routing",
      "✅ Cost-effective responses"
    ],
    endpoints: {
      chat: "POST /chat - Main chat endpoint (handles ANY question)",
      health: "GET /health - System health check",
      stats: "GET /stats - Performance analytics",
      test: "GET /test - Service test with examples",
      switch_model: "POST /admin/switch-model - Change AI model"
    }
  });
});

// Start server
async function startServer() {
  try {
    console.log("🚀 Starting Zivy backend with Smart Routing...");
    
    // Start server first
    app.listen(port, () => {
      const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";
      
      console.log("🎉 ================================");
      console.log("🎉 Zivy Backend - Smart AI Assistant");
      console.log("🎉 ================================");
      console.log(`✅ Server running on port ${port}`);
      console.log(`🌐 URL: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}`);
      console.log(`🤖 Model: ${modelName}`);
      console.log(`🧠 Mode: Smart Routing (Travdif + General Knowledge)`);
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
