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
  "http://localhost:3000"                               // local testing
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

// Load TravDif knowledge text file
const knowledgePath = path.join(__dirname, "travdif_knowledge.txt");
const travdifKnowledge = fs.readFileSync(knowledgePath, "utf-8");

// Initialize OpenAI client with API key from environment variable
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/chat", async (req, res) => {
  const messages = req.body.messages;
  
  if (!Array.isArray(messages)) {
    return res.status(400).json({ reply: "Invalid request format. 'messages' must be an array." });
  }

  try {
    // Replace or insert system prompt in the first message
    const updatedMessages = messages.map((msg, idx) => {
      if (idx === 0 && msg.role === "system") {
        return {
          role: "system",
          content: `
You are Zivy, an advanced AI assistant for Travdif.

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

Answer user questions about Travdif travel services accurately and engagingly.

Use the Travdif knowledge base to answer questions accurately.

${travdifKnowledge}
          `.trim()
        };
      }
      return msg;
    });

    const chatCompletion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: updatedMessages
    });

    const reply = chatCompletion.choices[0].message.content;
    res.json({ reply });
  } catch (error) {
    console.error("OpenAI Error:", error);
    res.status(500).json({ reply: "Sorry, Zivy is having trouble responding right now." });
  }
});

app.listen(port, () => {
  console.log(`✅ Zivy backend running on port ${port}`);
});
