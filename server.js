const express = require("express");
const cors = require("cors");
const { OpenAI } = require("openai");
const fs = require("fs");
const path = require("path");

const app = express();
const port = 3000;

// IMPORTANT: Update the origins below if your frontend is hosted elsewhere!
app.use(cors({
  origin: [
    "https://travdif.com",
    "https://www.travdif.com",
    "https://incomparable-heliotrope-f687a0.netlify.app", // Netlify test site
    "http://localhost:3000"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.options("*", cors());

app.use(express.json());

// Load TravDif knowledge base text file
const knowledgePath = path.join(__dirname, "travdif_knowledge.txt");
const travdifKnowledge = fs.readFileSync(knowledgePath, "utf-8");

// OpenAI client from env variable (DO NOT hardcode the key)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/chat", async (req, res) => {
  const messages = req.body.messages;
  if (!Array.isArray(messages)) {
    return res.status(400).json({ reply: "Invalid request format." });
  }

  try {
    const chatCompletion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages.map((msg, idx) => {
        if (idx === 0 && msg.role === "system") {
          // Always ensure the first prompt is your precise Zivy tone and knowledge setup!
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
      })
    });
    const reply = chatCompletion.choices[0].message.content;
    res.json({ reply });
  } catch (error) {
    console.error("OpenAI Error:", error);
    res.status(500).json({ reply: "Sorry, Zivy is having trouble right now." });
  }
});

app.listen(port, () => {
  console.log(`✅ Zivy backend running on port ${port}`);
});
