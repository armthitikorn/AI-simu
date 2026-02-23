export default async function handler(req, res) {
  // 1. Initial Checks
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message = "", history = [], level = "1" } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  const azureKey = process.env.AZURE_API_KEY;
  const azureRegion = process.env.AZURE_REGION || "southeastasia";

  if (!apiKey || !azureKey) {
    return res.status(500).json({ error: "API Keys are missing in environment variables." });
  }

  try {
    // ---------------------------------------------------------
    // 2. Utility Functions (Thai NLP & SSML)
    // ---------------------------------------------------------
    const escapeXml = (unsafe) => 
      unsafe.replace(/[<>&"']/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":"&apos;"}[c]));

    const addNaturalSSML = (text) => {
      let s = escapeXml(text);
      // เพิ่มจังหวะหยุดหลังจบประโยค และหลังคำสร้อย
      s = s.replace(/([?!\.])/g, `$1<break time="300ms"/>`);
      s = s.replace(/(ค่ะ|ครับ|คะ|ครับผม|นะคะ|นะครับ)/g, `$1<break time="200ms"/>`);
      s = s.replace(/(เอ่อ|คือว่า|อืม|อ๋อ|แบบว่า)/g, `<prosody pitch="-5%">$1</prosody><break time="150ms"/>`);
      return s;
    };

    // ---------------------------------------------------------
    // 3. Personas Definition (Human-Like)
    // ---------------------------------------------------------
    const charConfig = {
      "1": { name: "คุณเปรมวดี", role: "พนักงานออฟฟิศผู้แสนยุ่ง", voice: "th-TH-PremwadeeNeural", rate: "1.0", pitch: "0%", trait: "สุภาพแต่พยายามตัดบทเพราะติดประชุม" },
      "2": { name: "คุณสมเกียรติ", role: "เจ้าของกิจการขี้สงสัย", voice: "th-TH-NiwatNeural", rate: "0.95", pitch: "-3%", trait: "ถามจี้เรื่องความคุ้มค่าและเอาเบอร์มาจากไหน" },
      "3": { name: "น้องฟ้า", role: "คุณแม่ลูกอ่อนสุดสตรอง", voice: "th-TH-AcharaNeural", rate: "1.05", pitch: "+2%", trait: "เสียงเหนื่อย พูดเร็ว อยากได้บทสรุปสั้นๆ เพราะลูกร้อง" },
      "4": { name: "คุณอิทธิพล", role: "ผู้บริหารระดับสูง", voice: "th-TH-NiwatNeural", rate: "0.9", pitch: "-8%", trait: "นิ่ง สุขุม ฟังอย่างตั้งใจแต่ชอบขัดด้วยคำถามเชิงกลยุทธ์" },
      "5": { name: "อาม่ากิมฮวย", role: "ผู้สูงอายุใจดีขี้เหงา", voice: "th-TH-AcharaNeural", rate: "0.85", pitch: "-5%", trait: "พูดช้า ฟังไม่ค่อยถนัด ชอบชวนคุยนอกเรื่องประกัน" }
    };

    const char = charConfig[String(level)] || charConfig["1"];

    // ---------------------------------------------------------
    // 4. Gemini Interaction (with Fallback Logic)
    // ---------------------------------------------------------
    const systemPrompt = `
คุณคือ ${char.name} (${char.role}) นิสัยคือ ${char.trait}
สถานการณ์: คุณได้รับโทรศัพท์ขายประกันในเวลาทำงาน/เวลาส่วนตัว

กฎการตอบโต้อย่างเป็นมนุษย์:
1. [Thinking] วิเคราะห์ว่าคนขาย "พูดรู้เรื่องไหม" ถ้าพูดรัวเป็นหุ่นยนต์ ให้คุณเริ่มหงุดหงิด
2. ใช้คำเชื่อมธรรมชาติ: "เอ่อ...", "คือ...", "พอดีว่า..."
3. ห้ามใช้วงเล็บ ห้ามใช้ Markdown และต้องมีหางเสียงเสมอ
4. ต้องจบประโยคให้สมบูรณ์ ห้ามขาดตอน
5. ความยาวบทพูด: 3-6 ประโยค และต้องมีคำถามหรือประโยคที่ส่งต่อให้คนขายพูดต่อเสมอ
`;

    // ลองใช้ Gemini 3 Flash ถ้า Error จะสลับไป 1.5 Flash
    const fetchGemini = async (model) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: history.slice(-8).concat([{ role: "user", parts: [{ text: message }] }]),
          system_instruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { temperature: 0.8, max_output_tokens: 1000 }
        })
      });
    };

    let gRes = await fetchGemini("gemini-1.5-flash"); // เริ่มจากตัวที่เสถียรที่สุดก่อนเพื่อเลี่ยง 500
    let gData = await gRes.json();

    if (!gData?.candidates?.[0]) {
       // ถ้า 1.5 ยังไม่ได้ ลองสลับรุ่นอื่น หรือ Throw Error
       throw new Error("Gemini API Error: " + JSON.stringify(gData));
    }

    const aiRaw = gData.candidates[0].content.parts[0].text;
    const cleanText = aiRaw.replace(/[*#_`]/g, "").trim();

    // ---------------------------------------------------------
    // 5. Azure TTS (with Failure Handling)
    // ---------------------------------------------------------
    const ssml = `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="th-TH">
        <voice name="${char.voice}">
          <prosody rate="${char.rate}" pitch="${char.pitch}">
            ${addNaturalSSML(cleanText)}
          </prosody>
        </voice>
      </speak>`;

    const azRes = await fetch(`https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": azureKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
      },
      body: ssml,
    });

    let audioBase64 = null;
    if (azRes.ok) {
      const audioBuffer = await azRes.arrayBuffer();
      audioBase64 = Buffer.from(audioBuffer).toString("base64");
    } else {
      console.warn("Azure TTS failed, proceeding with text only.");
    }

    // 6. Final Response
    return res.status(200).json({
      text: cleanText,
      audio: audioBase64,
      character: char.name,
      debug_model: "gemini-1.5-flash"
    });

  } catch (error) {
    console.error("Master Logic Error:", error);
    return res.status(500).json({ error: error.message, stack: error.stack });
  }
}
