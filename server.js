const express = require("express");
const cors = require("cors");
const { OpenAI } = require("openai");

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

// CONFIGURATION - YOUR UPLOADED FILE ID
const CONFIG = {
  // Your uploaded file ID from OpenAI Storage
  FILE_ID: process.env.FILE_ID || "file-36BWZph37fnT8u7x8Nb52o",
  METHOD: "file"
};

// Global variables
let assistant = null;
const userThreads = new Map();
let totalRequests = 0;
let totalCost = 0;

// Initialize Assistant with your uploaded file
async function initializeAssistant() {
  try {
    console.log("🔄 Initializing Assistant with uploaded file...");
    console.log("📄 Using File ID:", CONFIG.FILE_ID);
    
    // Create assistant with file search using your uploaded file
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

Answer user questions about Travdif travel services accurately and engagingly using the knowledge base file.`,
      model: "gpt-4o",
      tools: [{ type: "file_search" }],
      tool_resources: {
        file_search: {
          vector_stores: [{
            file_ids: [CONFIG.FILE_ID]
          }]
        }
      }
    });

    console.log("✅ Assistant created successfully! ID:", assistant.id);
    console.log("📄 Connected to file:", CONFIG.FILE_ID);
    console.log("🚀 Zivy backend ready with file-based knowledge base!");
    
    return assistant;

  } catch (error) {
    console.error("❌ Assistant initialization failed:", error.message);
    
    if (error.message.includes("file")) {
      console.error("💡 Make sure your FILE_ID is correct:", CONFIG.FILE_ID);
      console.error("💡 Check that the file exists in OpenAI Storage");
    }
    
    throw error;
  }
}

// Generate session ID for thread management
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
    console.log(`📝 Processing: "${userQuery.substring(0, 50)}..."`);

    if (!assistant) {
      console.log("⚠️ Assistant not ready, initializing...");
      await initializeAssistant();
    }
    
    // Get or create thread for this user
    const sessionId = generateSessionId(req);
    let thread;
    
    if (userThreads.has(sessionId)) {
      thread = { id: userThreads.get(sessionId) };
    } else {
      thread = await openai.beta.threads.create();
      userThreads.set(sessionId, thread.id);
      
      // Cleanup old threads (keep memory usage reasonable)
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
      console.log("⚠️ Run status:", runStatus.status);
      if (runStatus.status === 'failed') {
        console.log("❌ Run failed:", runStatus.last_error);
      }
      return res.json({ 
        reply: "I'm processing your request. Please try again in a moment! 🔧" 
      });
    }

    // Get the assistant's response
    const messagesResponse = await openai.beta.threads.messages.list(thread.id);
    const assistantMessage = messagesResponse.data[0];
    
    if (!assistantMessage || assistantMessage.role !== 'assistant') {
      throw new Error("No assistant response found");
    }

    const reply = assistantMessage.content[0].text.value;

    // Estimate cost (GPT-4o pricing: $5 input, $15 output per 1M tokens)
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

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    assistant_ready: !!assistant,
    method: "file_storage",
    configuration: {
      file_id: CONFIG.FILE_ID,
      file_configured: CONFIG.FILE_ID !== "file_your_file_id_here"
    },
    stats: {
      total_requests: totalRequests,
      estimated_total_cost: `$${totalCost.toFixed(4)}`,
      avg_cost_per_request: totalRequests > 0 ? `$${(totalCost / totalRequests).toFixed(6)}` : "$0.000000"
    }
  });
});

// Performance stats endpoint
app.get("/stats", (req, res) => {
  res.json({
    mode: "File Storage + Assistant API",
    configuration: {
      method: "file",
      file_id: CONFIG.FILE_ID,
      model: "gpt-4o"
    },
    performance: {
      total_requests: totalRequests,
      assistant_calls: totalRequests,
      assistant_usage_rate: "100%"
    },
    cost_analysis: {
      estimated_total_cost: `$${totalCost.toFixed(4)}`,
      avg_cost_per_request: totalRequests > 0 ? `$${(totalCost / totalRequests).toFixed(6)}` : "$0.000000",
      monthly_projection_1000_req: `$${(totalCost / Math.max(totalRequests, 1) * 1000).toFixed(2)}`,
      knowledge_storage_cost: "FREE (under 1GB)"
    },
    active_threads: userThreads.size,
    benefits: [
      "Knowledge file stored in OpenAI (no input token charges)",
      "File search automatically finds relevant content",
      "Using GPT-4o model as requested",
      "Major cost savings vs sending full knowledge base each time"
    ]
  });
});

// Configuration debug endpoint
app.get("/config", (req, res) => {
  res.json({
    method: CONFIG.METHOD,
    file_id: CONFIG.FILE_ID,
    file_configured: CONFIG.FILE_ID !== "file_your_file_id_here",
    assistant_ready: !!assistant,
    environment_variables: {
      openai_api_key: !!process.env.OPENAI_API_KEY,
      file_id_env: !!process.env.FILE_ID
    },
    instructions: CONFIG.FILE_ID === "file_your_file_id_here" ? 
      "Set FILE_ID environment variable or update CONFIG.FILE_ID in code" : 
      "Configuration looks good!"
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Zivy Backend - File Storage Method",
    status: "healthy",
    assistant_ready: !!assistant,
    file_id: CONFIG.FILE_ID,
    documentation: {
      health: "/health - Check system status",
      stats: "/stats - Performance metrics", 
      config: "/config - Configuration details"
    }
  });
});

// Start server
async function startServer() {
  try {
    console.log("🚀 Starting Zivy backend with File Storage method...");
    
    // Validate OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }
    
    console.log("✅ OpenAI API key found");
    console.log("📄 Using File ID:", CONFIG.FILE_ID);
    
    // Start server
    app.listen(port, () => {
      console.log(`✅ Server running on port ${port}`);
      console.log(`📊 Health: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}/health`);
      console.log(`📈 Stats: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}/stats`);
      console.log(`⚙️ Config: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}/config`);
    });
    
    // Initialize assistant in background
    initializeAssistant().catch(error => {
      console.error("⚠️ Assistant initialization failed:", error.message);
      console.log("💡 Server running, but assistant needs valid FILE_ID");
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