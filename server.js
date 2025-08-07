const express = require("express");
const cors = require("cors");
const { OpenAI } = require("openai");
const fs = require("fs");
const path = require("path");

const app = express();
const port = 3000;

const allowedOrigins = [
  "https://travdif.com",
  "https://www.travdif.com",
  "https://incomparable-heliotrope-f687a0.netlify.app", // Netlify frontend URL
  "http://localhost:3000" // local testing
];

// CORS configuration to allow only specified origins
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like Postman or curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      return callback(new Error('CORS policy does not allow access from this origin'), false);
    }
    return callback(null, true);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Handle preflight OPTIONS requests
app.options("*", cors());
app.use(express.json());

// Initialize OpenAI client with API key from environment variable
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Global variables for assistant and conversation management
let assistant = null;
const userThreads = new Map(); // Store thread IDs per user session

// Performance metrics tracking
let totalRequests = 0;
let totalCost = 0;

// Initialize the OpenAI Assistant with File Search
async function initializeAssistant() {
  try {
    console.log("🔄 Initializing OpenAI Assistant with knowledge base...");
    
    const knowledgePath = path.join(__dirname, "travdif_knowledge.txt");
    
    if (!fs.existsSync(knowledgePath)) {
      throw new Error("Knowledge base file not found: travdif_knowledge.txt");
    }

    // Upload knowledge base file to OpenAI
    const file = await openai.files.create({
      file: fs.createReadStream(knowledgePath),
      purpose: "assistants"
    });

    console.log("✅ Knowledge base uploaded. File ID:", file.id);

    // Create vector store with the uploaded file
    const vectorStore = await openai.beta.vectorStores.create({
      name: "Travdif Knowledge Base",
      file_ids: [file.id]
    });

    console.log("✅ Vector store created. ID:", vectorStore.id);

    // Create assistant with file search capability
    assistant = await openai.beta.assistants.create({
      name: "Zivy - Travdif AI Assistant",
      instructions: `You are Zivy, an advanced AI assistant for Travdif.

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

Answer user questions about Travdif travel services accurately and engagingly using the knowledge base provided through file search.`,
      model: "gpt-4o-mini", // 96% cheaper than gpt-4o!
      tools: [{ type: "file_search" }],
      tool_resources: {
        file_search: {
          vector_store_ids: [vectorStore.id]
        }
      }
    });

    console.log("✅ Assistant created successfully! ID:", assistant.id);
    console.log("🚀 Zivy backend ready - all queries will use Assistant API with stored knowledge base!");
    
  } catch (error) {
    console.error("❌ Error initializing assistant:", error);
    throw error;
  }
}

// Generate unique session ID for thread management
function generateSessionId(req) {
  // Use IP + User-Agent for session identification
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'unknown';
  return Buffer.from(`${ip}-${userAgent}`).toString('base64').substring(0, 16);
}

// Main chat endpoint - ALL queries go to Assistant API
app.post("/chat", async (req, res) => {
  try {
    totalRequests++;
    
    const messages = req.body.messages;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ reply: "Invalid request format. 'messages' must be an array." });
    }

    // Get the latest user message
    const userMessage = messages[messages.length - 1];
    if (!userMessage || userMessage.role !== 'user') {
      return res.status(400).json({ reply: "Invalid message format." });
    }

    const userQuery = userMessage.content;
    
    console.log(`📝 Query: "${userQuery.substring(0, 50)}..." | Routing to Assistant API`);

    // Check if assistant is initialized
    if (!assistant) {
      throw new Error("Assistant not initialized");
    }
    
    // Get or create thread for this user session
    const sessionId = generateSessionId(req);
    let thread;
    
    if (userThreads.has(sessionId)) {
      thread = { id: userThreads.get(sessionId) };
    } else {
      thread = await openai.beta.threads.create();
      userThreads.set(sessionId, thread.id);
      
      // Clean up old threads (keep only last 1000)
      if (userThreads.size > 1000) {
        const firstKey = userThreads.keys().next().value;
        userThreads.delete(firstKey);
      }
    }

    // Add user message to thread
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userQuery
    });

    // Run assistant with file search
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistant.id
    });

    // Wait for completion with timeout
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds timeout
    
    while (runStatus.status === 'running' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      attempts++;
    }

    if (runStatus.status !== 'completed') {
      console.log("⚠️ Assistant run did not complete:", runStatus.status);
      return res.json({ reply: "I'm processing your request. Please try again in a moment! 🔧" });
    }

    // Get the assistant's response
    const messages_response = await openai.beta.threads.messages.list(thread.id);
    const assistantMessage = messages_response.data[0];
    
    if (!assistantMessage || assistantMessage.role !== 'assistant') {
      throw new Error("No assistant response found");
    }

    const reply = assistantMessage.content[0].text.value;

    // Estimate cost (GPT-4o mini: $0.15 per 1M input tokens, $0.60 per 1M output tokens)
    const estimatedInputTokens = userQuery.length / 4; // Rough estimate
    const estimatedOutputTokens = reply.length / 4;
    const estimatedCost = (estimatedInputTokens * 0.15 + estimatedOutputTokens * 0.60) / 1000000;
    totalCost += estimatedCost;

    console.log(`🎯 Assistant response delivered | Cost: ~$${estimatedCost.toFixed(6)}`);
    
    res.json({ reply });

  } catch (error) {
    console.error("❌ OpenAI Error:", error);
    res.status(500).json({ 
      reply: "Sorry, Zivy is having trouble responding right now. Please try again! 🔧" 
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    assistant_ready: !!assistant,
    mode: "all_queries_via_assistant_api",
    stats: {
      total_requests: totalRequests,
      all_assistant_calls: totalRequests, // All queries go to assistant
      estimated_total_cost: `$${totalCost.toFixed(4)}`,
      avg_cost_per_request: totalRequests > 0 ? `$${(totalCost / totalRequests).toFixed(6)}` : "$0.000000"
    }
  });
});

// Performance monitoring endpoint
app.get("/stats", (req, res) => {
  res.json({
    mode: "Direct Assistant API (No Caching)",
    performance: {
      total_requests: totalRequests,
      assistant_calls: totalRequests, // All queries use assistant
      assistant_usage_rate: "100%"
    },
    cost_analysis: {
      estimated_total_cost: `$${totalCost.toFixed(4)}`,
      avg_cost_per_request: totalRequests > 0 ? `$${(totalCost / totalRequests).toFixed(6)}` : "$0.000000",
      monthly_projection_1000_req: `$${(totalCost / Math.max(totalRequests, 1) * 1000).toFixed(2)}`,
      knowledge_base_storage: "FREE (stored in OpenAI, not counted as input tokens)"
    },
    active_threads: userThreads.size,
    benefits: [
      "Knowledge base stored in OpenAI (FREE under 1GB)",
      "No input token charges for knowledge base content",
      "Using GPT-4o-mini (96% cheaper than GPT-4o)",
      "Semantic search retrieves only relevant knowledge chunks"
    ]
  });
});

// Admin endpoint to reload knowledge base
app.post("/admin/reload-knowledge", async (req, res) => {
  try {
    console.log("🔄 Admin triggered knowledge base reload...");
    await initializeAssistant();
    console.log("✅ Knowledge base reloaded successfully!");
    res.json({ 
      status: "success", 
      message: "Knowledge base reloaded successfully",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Error reloading knowledge base:", error);
    res.status(500).json({ 
      status: "error", 
      message: "Failed to reload knowledge base",
      error: error.message 
    });
  }
});

// Initialize assistant and start server
async function startServer() {
  try {
    await initializeAssistant();
    
    app.listen(port, () => {
      console.log(`✅ Zivy backend running on port ${port}`);
      console.log(`📊 Health check: http://localhost:${port}/health`);
      console.log(`📈 Performance stats: http://localhost:${port}/stats`);
      console.log(`🔄 Reload knowledge: POST http://localhost:${port}/admin/reload-knowledge`);
      console.log(`🎯 Mode: All queries via Assistant API (no caching)`);
      console.log(`💰 Knowledge base stored in OpenAI (FREE) - major cost savings!`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📊 Final stats:');
  console.log(`   Total requests: ${totalRequests}`);
  console.log(`   Assistant calls: ${totalRequests} (100%)`);
  console.log(`   Total cost: $${totalCost.toFixed(4)}`);
  console.log('👋 Zivy backend shutting down gracefully...');
  process.exit(0);
});

startServer();