const express = require("express");
const cors = require("cors");
const { OpenAI } = require("openai");
const fs = require("fs");
const path = require("path");

const app = express();
const port = 3000;

// IMPORTANT: Update these origins to your actual client URLs
const allowedOrigins = [
  "https://travdif.com",
  "https://www.travdif.com",
  "https://incomparable-heliotrope-f687a0.netlify.app", // Your Netlify frontend
  "http://localhost:3000"
];

// Configure CORS to allow requests from allowed origins
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin like curl or Postman
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Enable preflight requests for all routes
app.options("*", cors());

app.use(express.json());

// Load TravDif knowledge base (ensure this file is in the same directory)
const knowledgePath = path.join(__dirname, "travdif_knowledge.txt");
const travdifKnowledge = fs.readFileSync(knowledgePath, "utf-8");

// Initialize OpenAI client with the API key from environment variable
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/chat", async (req, res) => {
  const messages = req.body.messages;

  if (!Array.isArray(messages)) {
    return res.status(400).json({ reply: "Invalid request format. 'messages' must be an array." });
  }

  try {
    // Replace system prompt in the first message if present
    const updatedMessages = messages.map((msg, idx) => {
      if (idx === 0 && msg.role === "system") {
        return {
          role: "system",
          content: `
You are Zivy, the AI assistant for TravDif.
Answer all questions concisely and clearly, with a friendly but professional tone.
Be warm and human, but avoid lengthy replies or unnecessary details.
Mirror the user's mood: act chill and casual if they are, businesslike if they're serious.
For store/product/support questions, always use TravDif's knowledge; for other topics, use your general world knowledge.

${travdifKnowledge}
          `.trim()
        };
      }
      return msg;
    });

    // Call OpenAI API with the full chat history
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
