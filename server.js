const express = require("express");
const cors = require("cors");
const { OpenAI } = require("openai");
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

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Global variables
let assistant = null;
const userThreads = new Map();
let totalRequests = 0;
let totalCost = 0;

// Initialize Assistant with knowledge base
async function initializeAssistant() {
  try {
    console.log("🔄 Starting Assistant initialization...");
    
    const knowledgePath = path.join(__dirname, "travdif_knowledge.txt");
    
    if (!fs.existsSync(knowledgePath)) {
      console.error("❌ Knowledge base file not found:", knowledgePath);
      throw new Error("travdif_knowledge.txt not found");
    }

    console.log("📤 Uploading knowledge base to OpenAI...");
    
    // Upload file
    const file = await openai.files.create({
      file: fs.createReadStream(knowledgePath),
      purpose: "assistants"
    });

    console.log("✅ File uploaded successfully. ID:", file.id);

    // Create vector store
    const vectorStore = await openai.beta.vectorStores.create({
      name: "Travdif Knowledge Base",
      file_ids: [file.id]
    });

    console.log("✅ Vector store created. ID:", vectorStore.id);

    // Wait for file processing
    console.log("⏳ Waiting for file processing...");
    let fileStatus = await openai.beta.vectorStores.files.retrieve(vectorStore.id, file.id);
    let attempts = 0;
    
    while (fileStatus.status === 'in_progress' && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      fileStatus = await openai.beta.vectorStores.files.retrieve(vectorStore.id, file.id);
      attempts++;
    }

    if (fileStatus.status !== 'completed') {
      console.log("⚠️ File processing status:", fileStatus.status);
    }

    // Create assistant
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

Answer user questions about Travdif travel services accurately and engagingly using the knowledge base.`,
      model: "gpt-4o",
      tools: [{ type: "file_search" }],
      tool_resources: {
        file_search: {
          vector_store_ids: [vectorStore.id]
        }
      }
    });

    console.log("✅ Assistant created successfully! ID:", assistant.id);
    console.log("🚀 Zivy backend is ready!");
    
    return assistant;

  } catch (error) {
    console.error("❌ Assistant initialization failed:", error.message);
    console.error("Stack trace:", error.stack);
    throw error;
  }
}

// Generate session ID
function generateSessionId(req) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  return Buffer.from(`${ip}-${userAgent}`).toString('base64').substring(0, 16);
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

    if (!assistant) {
      console.log("⚠️ Assistant not ready, initializing...");
      await initializeAssistant();
    }
    
    // Get or create thread
    const sessionId = generateSessionId(req);
    let thread;
    
    if (userThreads.has(sessionId)) {
      thread = { id: userThreads.get(sessionId) };
    } else {
      thread = await openai.beta.threads.create();
      userThreads.set(sessionId, thread.id);
      
      // Cleanup old threads
      if (userThreads.size > 1000) {
        const firstKey = userThreads.keys().next().value;
        userThreads.delete(firstKey);
      }
    }

    // Add message to thread
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userQuery
    });

    // Run assistant
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistant.id
    });

    // Wait for completion
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    let attempts = 0;
    const maxAttempts = 30;
    
    while (runStatus.status === 'running' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      attempts++;
    }

    if (runStatus.status !== 'completed') {
      console.log("⚠️ Run status:", runStatus.status);
      return res.json({ 
        reply: "I'm processing your request. Please try again in a moment! 🔧" 
      });
    }

    // Get response
    const messagesResponse = await openai.beta.threads.messages.list(thread.id);
    const assistantMessage = messagesResponse.data[0];
    
    if (!assistantMessage || assistantMessage.role !== 'assistant') {
      throw new Error("No assistant response found");
    }

    const reply = assistantMessage.content[0].text.value;

    // Estimate cost
    const estimatedInputTokens = userQuery.length / 4;
    const estimatedOutputTokens = reply.length / 4;
    const estimatedCost = (estimatedInputTokens * 5.0 + estimatedOutputTokens * 15.0) / 1000000;
    totalCost += estimatedCost;

    console.log(`✅ Response delivered | Cost: ~$${estimatedCost.toFixed(6)}`);
    
    res.json({ reply });

  } catch (error) {
    console.error("❌ Chat error:", error.message);
    res.status(500).json({ 
      reply: "Sorry, Zivy is having trouble responding right now. Please try again! 🔧" 
    });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    assistant_ready: !!assistant,
    mode: "assistant_api_only",
    stats: {
      total_requests: totalRequests,
      estimated_total_cost: `$${totalCost.toFixed(4)}`,
      avg_cost_per_request: totalRequests > 0 ? `$${(totalCost / totalRequests).toFixed(6)}` : "$0.000000"
    }
  });
});

// Stats endpoint
app.get("/stats", (req, res) => {
  res.json({
    mode: "Assistant API (No Caching)",
    performance: {
      total_requests: totalRequests,
      assistant_calls: totalRequests,
      assistant_usage_rate: "100%"
    },
    cost_analysis: {
      estimated_total_cost: `$${totalCost.toFixed(4)}`,
      avg_cost_per_request: totalRequests > 0 ? `$${(totalCost / totalRequests).toFixed(6)}` : "$0.000000",
      monthly_projection_1000_req: `$${(totalCost / Math.max(totalRequests, 1) * 1000).toFixed(2)}`
    },
    active_threads: userThreads.size
  });
});

// Reload knowledge endpoint
app.post("/admin/reload-knowledge", async (req, res) => {
  try {
    console.log("🔄 Reloading knowledge base...");
    await initializeAssistant();
    res.json({ 
      status: "success", 
      message: "Knowledge base reloaded successfully" 
    });
  } catch (error) {
    console.error("❌ Reload failed:", error.message);
    res.status(500).json({ 
      status: "error", 
      message: "Failed to reload knowledge base" 
    });
  }
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Zivy Backend is running!",
    status: "healthy",
    assistant_ready: !!assistant
  });
});

// Start server
async function startServer() {
  try {
    console.log("🚀 Starting Zivy backend...");
    
    // Check environment variables
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }
    
    console.log("✅ OpenAI API key found");
    
    // Start server first
    app.listen(port, () => {
      console.log(`✅ Server running on port ${port}`);
      console.log(`📊 Health: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}/health`);
      console.log(`📈 Stats: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}/stats`);
    });
    
    // Initialize assistant in background
    initializeAssistant().catch(error => {
      console.error("⚠️ Assistant initialization failed, but server is running:", error.message);
    });
    
  } catch (error) {
    console.error("❌ Server startup failed:", error.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📊 Final stats:');
  console.log(`   Total requests: ${totalRequests}`);
  console.log(`   Total cost: $${totalCost.toFixed(4)}`);
  console.log('👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error.message);
  console.error(error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

startServer();