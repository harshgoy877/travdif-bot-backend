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

// CONFIGURATION - SET THESE AFTER MANUAL UPLOAD
const CONFIG = {
  // OPTION 1: If you uploaded to Vector Stores (RECOMMENDED)
  VECTOR_STORE_ID: process.env.VECTOR_STORE_ID || "vs_6894cc76c64c8191927465f758ecf7c6",
  
  // OPTION 2: If you uploaded to Files (ALTERNATIVE)  
  FILE_ID: process.env.FILE_ID || "file_your_file_id_here",
  
  // Choose your method: "vector_store" or "file"
  METHOD: process.env.UPLOAD_METHOD || "vector_store" // Change to "file" if using files
};

// Global variables
let assistant = null;
const userThreads = new Map();
let totalRequests = 0;
let totalCost = 0;

// Initialize Assistant with manually uploaded knowledge
async function initializeAssistant() {
  try {
    console.log("🔄 Initializing Assistant with manually uploaded knowledge base...");
    console.log("📋 Method:", CONFIG.METHOD);
    
    let assistantConfig = {
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
      tools: [{ type: "file_search" }]
    };

    // Configure based on upload method
    if (CONFIG.METHOD === "vector_store") {
      console.log("🗂️ Using Vector Store ID:", CONFIG.VECTOR_STORE_ID);
      assistantConfig.tool_resources = {
        file_search: {
          vector_store_ids: [CONFIG.VECTOR_STORE_ID]
        }
      };
    } else if (CONFIG.METHOD === "file") {
      console.log("📄 Using File ID:", CONFIG.FILE_ID);
      assistantConfig.tool_resources = {
        file_search: {
          vector_stores: [{
            file_ids: [CONFIG.FILE_ID]
          }]
        }
      };
    }

    // Create assistant
    assistant = await openai.beta.assistants.create(assistantConfig);

    console.log("✅ Assistant created successfully! ID:", assistant.id);
    console.log("🚀 Zivy backend ready with manually uploaded knowledge base!");
    
    return assistant;

  } catch (error) {
    console.error("❌ Assistant initialization failed:", error.message);
    
    // Helpful error messages
    if (error.message.includes("vector_store")) {
      console.error("💡 Check your VECTOR_STORE_ID in environment variables or CONFIG");
    }
    if (error.message.includes("file")) {
      console.error("💡 Check your FILE_ID in environment variables or CONFIG");
    }
    
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
    console.log(`📝 Processing: "${userQuery.substring(0, 50)}..."`);

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
      if (runStatus.status === 'failed') {
        console.log("❌ Run failed:", runStatus.last_error);
      }
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

    // Estimate cost (GPT-4o pricing)
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
    config: {
      method: CONFIG.METHOD,
      vector_store_id: CONFIG.METHOD === "vector_store" ? CONFIG.VECTOR_STORE_ID : "N/A",
      file_id: CONFIG.METHOD === "file" ? CONFIG.FILE_ID : "N/A"
    },
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
    mode: "Manual Upload + Assistant API",
    configuration: {
      upload_method: CONFIG.METHOD,
      knowledge_base: CONFIG.METHOD === "vector_store" ? CONFIG.VECTOR_STORE_ID : CONFIG.FILE_ID
    },
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

// Configuration endpoint (for debugging)
app.get("/config", (req, res) => {
  res.json({
    method: CONFIG.METHOD,
    vector_store_configured: CONFIG.VECTOR_STORE_ID !== "vs_your_vector_store_id_here",
    file_configured: CONFIG.FILE_ID !== "file_your_file_id_here",
    assistant_ready: !!assistant,
    environment_variables: {
      openai_api_key: !!process.env.OPENAI_API_KEY,
      vector_store_id: !!process.env.VECTOR_STORE_ID,
      file_id: !!process.env.FILE_ID,
      upload_method: !!process.env.UPLOAD_METHOD
    }
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Zivy Backend with Manual Upload Setup",
    status: "healthy",
    assistant_ready: !!assistant,
    instructions: "Configure VECTOR_STORE_ID or FILE_ID in environment variables"
  });
});

// Start server
async function startServer() {
  try {
    console.log("🚀 Starting Zivy backend with manual upload setup...");
    
    // Check environment variables
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }
    
    console.log("✅ OpenAI API key found");
    
    // Validate configuration
    if (CONFIG.METHOD === "vector_store" && CONFIG.VECTOR_STORE_ID === "vs_your_vector_store_id_here") {
      console.log("⚠️ VECTOR_STORE_ID not configured - please set it in environment variables");
    }
    
    if (CONFIG.METHOD === "file" && CONFIG.FILE_ID === "file_your_file_id_here") {
      console.log("⚠️ FILE_ID not configured - please set it in environment variables");
    }
    
    // Start server first
    app.listen(port, () => {
      console.log(`✅ Server running on port ${port}`);
      console.log(`📊 Health: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}/health`);
      console.log(`📈 Stats: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}/stats`);
      console.log(`⚙️ Config: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}/config`);
    });
    
    // Initialize assistant in background
    initializeAssistant().catch(error => {
      console.error("⚠️ Assistant initialization failed:", error.message);
      console.log("💡 Server is running, but you need to configure Vector Store ID or File ID");
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
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
  process.exit(1);
});

startServer();