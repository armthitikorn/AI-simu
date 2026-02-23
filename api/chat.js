export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message = "", history = [], level = "1" } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  const azureKey = process.env.AZURE_API_KEY;
  const azureRegion = process.env.AZURE_REGION || "southeastasia";

  try {
    // ---------------------------------------------------------
    // 1. นวัตกรรมใหม่: ระบบวิเคราะห์ความสมจริง (Utility)
    // ---------------------------------------------------------
    const getThaiLength = (t) => t.replace(/\s/g, "").length;

    const addAdvancedSSML = (text) => {
      return text
        .replace(/([?!\.])\s*/g, `$1<break time="300ms"/>`) // จบประโยคคำถาม/ตกใจ พักนานขึ้น
        .replace(/(ครับ|ค่ะ|คะ|นะครับ|นะคะ)/g, `$1<break time="150ms"/>`) // หางเสียง
        .replace(/(เอ่อ|คือว่า|อืม|อ๋อ)/g, `<prosody pitch="-5%">$1</prosody><break time="100ms"/>`); // คำสร้อย
    };

    // ---------------------------------------------------------
    // 2. ข้อมูลลูกค้า 5 สไตล์ (Human-Centric Personas)
    // ---------------------------------------------------------
    const charConfig = {
      "1": {
        name: "คุณเปรมวดี",
        role: "พนักงานบริษัทวัยกลางคน",
        trait: "ใจดี สุภาพ แต่ยุ่งมาก ชอบพูดแทรกว่า 'ค่ะๆ ฟังอยู่ค่ะ' แต่ในใจอยากวางสาย",
        voice: "th-TH-PremwadeeNeural", rate: "1.0", pitch: "0%"
      },
      "2": {
        name: "คุณสมเกียรติ",
        role: "เจ้าของธุรกิจขี้ระแวง",
        trait: "เน้นตัวเลข พูดจาโผงผาง ชอบถามว่า 'เอาเบอร์ผมมาจากไหน?' และ 'สรุปสั้นๆ ได้ไหม?'",
        voice: "th-TH-NiwatNeural", rate: "0.95", pitch: "-3%"
      },
      "3": {
        name: "น้องฟ้า",
        role: "คุณแม่ลูกอ่อนสุดสตรอง",
        trait: "เสียงเหนื่อยๆ มีเสียงลูกร้องแทรก (สมมติ) จะหงุดหงิดถ้าคนขายพูดสคริปต์ยาวโดยไม่ฟังเธอ",
        voice: "th-TH-AcharaNeural", rate: "1.05", pitch: "+2%"
      },
      "4": {
        name: "คุณอิทธิพล",
        role: "ผู้บริหารระดับสูง",
        trait: "นิ่ง สุขุม พูดน้อยแต่หนักแน่น ชอบถามกลับว่า 'สิทธิประโยชน์นี้ต่างจากเจ้าเดิมยังไง?'",
        voice: "th-TH-NiwatNeural", rate: "0.85", pitch: "-8%"
      },
      "5": {
        name: "อาม่ากิมฮวย",
        role: "ผู้สูงอายุใจดีขี้เหงา",
        trait: "พูดช้า ชอบเล่าเรื่องอื่นแทรก ถามซ้ำเพราะหูไม่ดี เป็นโจทย์หินเรื่องการดึงกลับเข้าเรื่องประกัน",
        voice: "th-TH-AcharaNeural", rate: "0.80", pitch: "-5%"
      }
    };

    const char = charConfig[String(level)] || charConfig["1"];

    // ---------------------------------------------------------
    // 3. System Prompt (The Master Logic)
    // ---------------------------------------------------------
    const systemPrompt = `
คุณคือ ${char.name} ผู้รับสายโทรศัพท์ (${char.role})
นิสัยและอารมณ์: ${char.trait}

ภารกิจของคุณ: ตอบโต้กับพนักงานขายประกันให้สมจริงที่สุด
กฎเหล็กที่ต้องปฏิบัติ (Strict Human Protocol):
1. **กระบวนการคิด (Inner Thought)**: ก่อนตอบ ให้ประเมินว่าพนักงานขาย "พูดดีไหม" "น่ารำคาญไหม" แล้วแสดงออกผ่านน้ำเสียง
2. **ความเป็นมนุษย์**: ห้ามตอบเป็นหุ่นยนต์ ให้มีคำสร้อย เช่น "เอ่อ...", "อ๋อ...พอดีว่า", "อืม...อันนี้ไม่แน่ใจ"
3. **การจบประโยค**: ต้องจบประโยคให้สมบูรณ์พร้อมหางเสียง ${char.name.includes("คุณ") ? "ครับ/ค่ะ" : "คะ/ค่ะ"} เสมอ
4. **ห้ามใช้วงเล็บ**: ห้ามใส่ (หัวเราะ) หรือ [ถอนหายใจ] ให้ใช้คำพูดบรรยายอารมณ์แทน เช่น "เห้อ...คือตอนนี้รีบจริงๆ ค่ะ"
5. **การโต้ตอบ**: ต้องมีทั้งส่วนที่ "ตอบรับ" และ "ถามกลับ" เพื่อให้คนขายได้ฝึกต่อยอด
6. **ความยาว**: ต้องพูดอย่างน้อย 3-5 ประโยคเพื่อให้เสียง TTS มีจังหวะที่เป็นธรรมชาติ

รูปแบบการตอบ: ภาษาไทยปกติที่คนคุยโทรศัพท์กัน ห้ามมีภาษาอังกฤษเด็ดขาด
`;

    // ---------------------------------------------------------
    // 4. Gemini 3 Flash API Call
    // ---------------------------------------------------------
    const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${apiKey}`;

    const gRes = await fetch(gUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: history.slice(-10).concat([{ role: "user", parts: [{ text: message }] }]),
        system_instruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 0.75, // ความสมดุลระหว่างความนิ่งและความคิดสร้างสรรค์
          top_p: 0.95,
          max_output_tokens: 1000,
          stop_sequences: ["\n\n"]
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" }
        ]
      }),
    });

    const gData = await gRes.json();
    let aiRaw = gData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!aiRaw) throw new Error("AI Silence Error");

    // ล้าง Markdown และสัญลักษณ์ที่ไม่จำเป็นออก
    const cleanText = aiRaw.replace(/[*#_`]/g, "").trim();

    // ---------------------------------------------------------
    // 5. Azure TTS Integration (Advanced SSML)
    // ---------------------------------------------------------
    const ssmlBody = addAdvancedSSML(cleanText);
    const ssml = `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="th-TH">
        <voice name="${char.voice}">
          <prosody rate="${char.rate}" pitch="${char.pitch}">
            ${ssmlBody}
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

    const audioBuffer = await azRes.arrayBuffer();

    return res.status(200).json({
      text: cleanText,
      audio: Buffer.from(audioBuffer).toString("base64"),
      character: char.name
    });

  } catch (e) {
    console.error("Master Logic Error:", e);
    return res.status(500).json({ error: e.message });
  }
}
