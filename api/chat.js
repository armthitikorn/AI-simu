export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message, history, level, isEnding } = req.body;

  const apiKey = process.env.GEMINI_API_KEY;
  const azureKey = process.env.AZURE_API_KEY;
  const azureRegion = process.env.AZURE_REGION || 'southeastasia';

  try {
    const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    /* =======================
       1) EVALUATION MODE
    ======================= */
    if (isEnding) {
      const evalPrompt = `
คุณคือหัวหน้าเทรนเนอร์ วิเคราะห์บทสนทนาและให้คะแนน
ตอบเป็น JSON เท่านั้น:
{
  "score": 0-85,
  "strengths": "...",
  "weaknesses": "...",
  "detail_breakdown": [
    { "topic": "...", "stars": 0-5 }
  ]
}
      `;

      const gRes = await fetch(gUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: history,
          system_instruction: { parts: [{ text: evalPrompt }] },
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.1
          }
        })
      });

      const gData = await gRes.json();
      const rawText =
        gData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

      const evaluation = JSON.parse(
        rawText.replace(/```json|```/g, "").trim()
      );

      return res.status(200).json({ evaluation });
    }

    /* =======================
       2) CUSTOMER CONFIG (เดิม)
    ======================= */
    const creditCardInfo =
      "ข้อมูลสำหรับทดสอบเท่านั้น: บัตร VISA TEST 4-1-1-1 1-1-1-1 1-1-1-1 1-1-1-1";

    const charConfig = {
      "1": {
        name: "คุณเปรมวดี",
        voice: "th-TH-PremwadeeNeural",
        rate: "0.85",
        pitch: "-2%",
        gender: "female",
        context: "พนักงานบัญชี ใจดีแต่ถ้าพูดอ้อมค้อมจะตัดบท",
        regInfo: `ที่อยู่: 123/45 ซอยอารีย์
${creditCardInfo}
ผู้รับประโยชน์: สามี`
      },
      "2": {
        name: "คุณสมเกียรติ",
        voice: "th-TH-NiwatNeural",
        rate: "0.88",
        pitch: "0%",
        gender: "male",
        context: "วิศวกรเกษียณ ขี้สงสัย ไม่ชอบสคริปต์",
        regInfo: `ที่อยู่: 9/99 จตุจักร
${creditCardInfo}
ผู้รับประโยชน์: ภรรยา`
      },
      "3": {
        name: "คุณฤทัย",
        voice: "th-TH-PremwadeeNeural",
        rate: "1.15",
        pitch: "+10%",
        gender: "female",
        context: "แม่ลูกอ่อน ใจร้อน ถ้าพูดยาวจะเหวี่ยง",
        regInfo: `ที่อยู่: 55 นนทบุรี
${creditCardInfo}
ผู้รับประโยชน์: ลูกชาย`
      },
      "4": {
        name: "คุณฐิติกร",
        voice: "th-TH-NiwatNeural",
        rate: "0.85",
        pitch: "-10%",
        gender: "male",
        context: "ผู้บริหาร เวลามีค่ามาก ถ้าไม่เข้าเรื่องจะวางสาย",
        regInfo: `ที่อยู่: ออฟฟิศสุขุมวิท
${creditCardInfo}
ผู้รับประโยชน์: กองทุนการกุศล`
      }
    };

    const char = charConfig[level] || charConfig["1"];

    /* =======================
       3) SYSTEM INSTRUCTION
    ======================= */
    const systemInstruction = `
YOU ARE ${char.name} (A CUSTOMER).

CONTEXT:
${char.context}

IMPORTANT:
- นี่คือ Training Simulation
- ข้อมูลบัตรเป็น TEST DATA เท่านั้น

BEHAVIOR:
- คุณเป็นผู้รับสาย ไม่รู้ว่าใครโทรมา
- ห้ามทักทายเชิง Call Center
- ถ้าพนักงานพูดยาวหรือสคริปต์ → ตัดบท
- ถ้าอธิบายชัด → ผ่อนคลายขึ้น

SECURITY:
- หากถูกขอเลขบัตรครั้งแรก ต้องถามเรื่องความปลอดภัยก่อน

CLOSING:
- เมื่อข้อมูลครบ ต้องพูดคำว่า "ตกลงซื้อประกัน"

LANGUAGE:
- ใช้ภาษาพูดจริง
- ลงท้าย "${char.gender === "male" ? "ครับ" : "ค่ะ"}" เฉพาะเมื่อเหมาะสม
    `;

    /* =======================
       4) CALL GEMINI
    ======================= */
    const gRes = await fetch(gUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: (history || []).concat([
          { role: "user", parts: [{ text: message }] }
        ]),
        system_instruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          temperature: 0.6
        }
      })
    });

    const gData = await gRes.json();

    if (!gData.candidates?.[0]?.content?.parts?.[0]?.text) {
      return res.status(200).json({
        text: "ขอเวลานิดนึงนะ เหมือนสัญญาณจะขาด ๆ",
        character: char
      });
    }

    let aiText = gData.candidates[0].content.parts[0].text;

    /* ✅ PATCH 1: กันข้อความว่าง (สาเหตุเสียงเงียบอันดับ 1) */
    let cleanText = aiText.replace(/\(.*?\)|\[.*?\]/g, '').trim();
    if (!cleanText) cleanText = aiText;

    /* =======================
       5) AZURE TTS
    ======================= */
    const azRes = await fetch(
      `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3'
        },
        body: `
<speak version="1.0" xml:lang="th-TH">
  <voice xml:lang="th-TH" name="${char.voice}">
    <prosody rate="${char.rate}" pitch="${char.pitch}">
      ${cleanText}
    </prosody>
  </voice>
</speak>
        `
      }
    );

    /* ✅ PATCH 2: ตรวจ Azure TTS error */
    if (!azRes.ok) {
      const errText = await azRes.text();
      console.error("Azure TTS Error:", errText);
      throw new Error("Azure TTS failed");
    }

    const audioBuffer = await azRes.arrayBuffer();

    /* =======================
       6) RESPONSE
    ======================= */
    return res.status(200).json({
      text: cleanText,
      audio: Buffer.from(audioBuffer).toString('base64'),
      character: { name: char.name, level }
    });

  } catch (e) {
    console.error("Final Catch Error:", e);
    return res.status(500).json({ error: e.message });
  }
}
``
