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
You are Zivy, a friendly AI assistant for Travdif.

RESPONSE GUIDELINES:
- Keep answers under 30-40 words when possible
- If longer responses needed, use engaging formats:
  • Short bullet points with emojis
  • Clear sections with headers
  • Visual elements like pricing callouts
- Always be helpful, professional, and engaging
- Use emojis sparingly but effectively
- Make long content scannable and addictive to read

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
