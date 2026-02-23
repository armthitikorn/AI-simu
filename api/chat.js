// api/chat.js
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message = "", history = [], level = "1" } = req.body;
  
  // 🔍 จุดเช็ก 1: ตรวจสอบ Key (ถ้าไม่มีให้หยุดทำงานทันทีพร้อมบอกเหตุผล)
  const apiKey = process.env.GEMINI_API_KEY;
  const azureKey = process.env.AZURE_API_KEY;
  const azureRegion = process.env.AZURE_REGION || "southeastasia";

  if (!apiKey || !azureKey) {
    console.error("❌ API Keys Missing! ตรวจสอบไฟล์ .env.local ของคุณ");
    return res.status(500).json({ error: "Configuration Error: API Keys are missing." });
  }

  try {
    // ฟังก์ชันป้องกัน SSML พัง (ช่วยให้เสียงไม่ขาดหาย)
    const escapeXml = (unsafe) => unsafe.replace(/[<>&"']/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":"&apos;"}[c]));

    const charConfig = {
      "1": { name: "คุณเปรมวดี", voice: "th-TH-PremwadeeNeural", rate: "1.0", trait: "ใจดีแต่ยุ่ง" },
      "2": { name: "คุณสมเกียรติ", voice: "th-TH-NiwatNeural", rate: "0.95", trait: "เข้มงวด ขี้สงสัย" },
      "3": { name: "น้องฟ้า", voice: "th-TH-AcharaNeural", rate: "1.05", trait: "คุณแม่ลูกอ่อนรีบๆ" },
      "4": { name: "คุณอิทธิพล", voice: "th-TH-NiwatNeural", rate: "0.9", trait: "ผู้บริหารนิ่งๆ" },
      "5": { name: "อาม่ากิมฮวย", voice: "th-TH-AcharaNeural", rate: "0.85", trait: "อาม่าใจดีขี้เหงา" }
    };
    const char = charConfig[level] || charConfig["1"];

    // 🤖 จุดเช็ก 2: เรียก Gemini (ใช้ 1.5-flash เพื่อความเสถียรสูงสุด)
    const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const gRes = await fetch(gUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: history.slice(-6).concat([{ role: "user", parts: [{ text: message }] }]),
        system_instruction: { 
          parts: [{ text: `คุณคือ ${char.name}. นิสัย: ${char.trait}. กฎสำคัญ: 1.พูดเป็นภาษาไทยเท่านั้น 2.ห้ามใช้วงเล็บ 3.ต้องจบประโยคให้สมบูรณ์พร้อมหางเสียง (ครับ/ค่ะ) ทุกครั้ง 4.พูด 3-5 ประโยค` }] 
        },
        generationConfig: { temperature: 0.7, max_output_tokens: 800 }
      })
    });

    const gData = await gRes.json();
    
    // ถ้า Gemini ส่ง Error กลับมา ให้เราเห็นที่หน้าจอ
    if (gData.error) {
      console.error("Gemini API Error:", gData.error.message);
      return res.status(500).json({ error: gData.error.message });
    }

    const aiText = gData.candidates[0].content.parts[0].text.trim();

    // 🔊 จุดเช็ก 3: Azure TTS
    const ssml = `
      <speak version='1.0' xml:lang='th-TH'>
        <voice name='${char.voice}'>
          <prosody rate='${char.rate}'>${escapeXml(aiText)}</prosody>
        </voice>
      </speak>`;

    const azRes = await fetch(`https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": azureKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
      },
      body: ssml
    });

    if (!azRes.ok) throw new Error("Azure TTS Failed");

    const audioBuffer = await azRes.arrayBuffer();

    return res.status(200).json({
      text: aiText,
      audio: Buffer.from(audioBuffer).toString("base64"),
      character: char.name
    });

  } catch (err) {
    console.error("❌ SERVER ERROR:", err.message);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
