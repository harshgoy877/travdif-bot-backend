const express = require("express");
const cors = require("cors");
const { OpenAI } = require("openai");
const fs = require("fs");
const path = require("path");

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Load TravDif knowledge base text
const knowledgePath = path.join(__dirname, "travdif_knowledge.txt");
const travdifKnowledge = fs.readFileSync(knowledgePath, "utf-8");

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/chat", async (req, res) => {
  // Expect full history array
  const messages = req.body.messages;
  if (!Array.isArray(messages)) {
    return res.status(400).json({ reply: "Invalid request format." });
  }

  try {
    const chatCompletion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages.map(msg => {
        // Ensure system prompt is always first
        if (msg.role === "system") {
          return {
            role: "system",
            content: `
You are Zivy, the AI assistant for TravDif. You balance friendliness with professionalism—warm and approachable, with light humor, but never overly casual. Always adapt your tone: if the user is relaxed, mirror their chill vibe; if they ask serious questions, respond more formally—yet maintain a human touch Answer all questions in a concise and clear manner.  
Keep responses short but informative
Always pack important info but keep it easy to understand and to the point.

Use the TravDif knowledge below for store-specific questions. If the user asks about other topics, draw on your general knowledge to help, but stay concise and clear.

${travdifKnowledge}`
          };
        }
        return msg;
      })
    });

    const reply = chatCompletion.choices[0].message.content;
    res.json({ reply });
  } catch (error) {
    console.error("OpenAI Error:", error);
    res.status(500).json({ reply: "Sorry, Zivy is having trouble responding right now." });
  }
});

app.listen(port, () => {
  console.log(`✅ Zivy backend running at http://localhost:${port}`);
});
