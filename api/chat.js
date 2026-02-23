// api/chat.js
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message, history, level } = req.body;
  
  // 1. ตรวจสอบ ENV (จุดที่มักจะทำให้เกิด 500)
  const apiKey = process.env.GEMINI_API_KEY;
  const azureKey = process.env.AZURE_API_KEY;

  if (!apiKey || !azureKey) {
    return res.status(500).json({ 
      error: "Config Error: API Keys missing!", 
      details: "ตรวจสอบไฟล์ .env.local ของคุณว่ามี GEMINI_API_KEY และ AZURE_API_KEY หรือยัง" 
    });
  }

  try {
    // 2. ตั้งค่าลูกค้า (เหมือนเดิม)
    const charConfig = {
      "1": { name: "คุณเปรมวดี", voice: "th-TH-PremwadeeNeural", trait: "ใจดีแต่ยุ่ง" },
      "2": { name: "คุณสมเกียรติ", voice: "th-TH-NiwatNeural", trait: "เข้มงวด ขี้สงสัย" },
      // ... เพิ่มให้ครบ 5 คนตามที่คุยกัน
    };
    const char = charConfig[level] || charConfig["1"];

    // 3. เรียก Gemini (ใช้ 1.5-flash เพื่อความเสถียรสูงสุดในการเทสครั้งแรก)
    const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const gRes = await fetch(gUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: history.slice(-6).concat([{ role: "user", parts: [{ text: message }] }]),
        system_instruction: { 
          parts: [{ text: `คุณคือ ${char.name} นิสัยคือ ${char.trait}. ตอบเป็นภาษาไทย ห้ามมีวงเล็บ ห้ามมีมาร์กดาวน์ และต้องจบประโยคเสมอ.` }] 
        },
        generationConfig: { temperature: 0.7, max_output_tokens: 500 }
      })
    });

    const gData = await gRes.json();
    if (gData.error) throw new Error(`Gemini Error: ${gData.error.message}`);

    const aiText = gData.candidates[0].content.parts[0].text.trim();

    // 4. เรียก Azure TTS
    const azureRegion = process.env.AZURE_REGION || "southeastasia";
    const azRes = await fetch(`https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": azureKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
      },
      body: `<speak version='1.0' xml:lang='th-TH'><voice name='${char.voice}'>${aiText}</voice></speak>`
    });

    if (!azRes.ok) throw new Error(`Azure TTS Error: ${azRes.statusText}`);

    const audioBuffer = await azRes.arrayBuffer();

    // 5. ส่งผลลัพธ์กลับ
    return res.status(200).json({
      text: aiText,
      audio: Buffer.from(audioBuffer).toString("base64")
    });

  } catch (err) {
    console.error("DEBUG ERROR:", err.message);
    return res.status(500).json({ 
      error: "Server Error", 
      message: err.message // ส่ง Error ออกไปให้เห็นที่หน้าบ้านเลย
    });
  }
}
