export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message = "", history = [], level = "1", isEnding = false } = req.body;

  const apiKey = process.env.GEMINI_API_KEY;
  const azureKey = process.env.AZURE_API_KEY;
  const azureRegion = process.env.AZURE_REGION || "southeastasia";

  if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
  if (!azureKey) return res.status(500).json({ error: "Missing AZURE_API_KEY" });

  try {
    // ---------------------------
    // 0) Utility
    // ---------------------------
    const escapeXml = (unsafe = "") =>
      unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

    const normalizeHistoryToGemini = (arr) => {
      // Gemini format: [{ role: "user"|"model", parts: [{text:"..."}] }]
      // Support legacy role: "assistant" -> "model"
      const out = [];
      for (const item of Array.isArray(arr) ? arr : []) {
        if (!item) continue;
        const roleRaw = item.role || "user";
        const role = roleRaw === "assistant" ? "model" : roleRaw;
        const text =
          item?.parts?.[0]?.text ??
          item?.content ??
          item?.text ??
          "";

        if (!text) continue;
        if (role !== "user" && role !== "model") continue;

        out.push({ role, parts: [{ text: String(text) }] });
      }
      // จำกัดประวัติไม่ให้ยาวเกินไป (กันหลุดและลดค่าใช้จ่าย)
      return out.slice(-16);
    };

    const cleanOutputText = (txt = "") => {
      // ล้างสิ่งที่ไม่ต้องการ เช่น markdown / วงเล็บ / สัญลักษณ์พิเศษ
      return String(txt)
        .replace(/\(.*?\)/g, "")      // ลบ (...)
        .replace(/\[.*?\]/g, "")      // ลบ [...]
        .replace(/[*#_`]/g, "")       // ลบ markdown
        .replace(/[-•]\s+/g, "")      // ลบ bullet
        .replace(/\s+/g, " ")
        .trim();
    };

    const addNaturalPausesForSSML = (txt = "") => {
      // ใส่จังหวะพักเล็กน้อยหลังประโยค/คำลงท้าย ช่วยให้เสียงดูเป็นคนมากขึ้น
      // หมายเหตุ: แก้เฉพาะสำหรับ SSML ไม่กระทบ text ที่ส่งกลับ
      let s = txt;

      // พักหลังเครื่องหมายจบประโยค
      s = s.replace(/([?!\.])\s*/g, `$1<break time="220ms"/>`);

      // พักหลังคำลงท้ายที่พบบ่อย
      s = s.replace(/(ค่ะ|ครับ|คะ|ครับผม)\s+/g, `$1<break time="180ms"/>`);

      // พักหลังคำเชื่อมแบบคนคิด
      s = s.replace(/(เอ่อ|อ๋อ|คือว่า|พอดีว่า)\s*/g, `$1...<break time="200ms"/>`);

      return s;
    };

    // ---------------------------
    // 1) Forbidden words filter
    // ---------------------------
    const forbiddenWords = ["วะ", "โว้ย", "มึง", "กู", "ไอ้", "ควย", "ห่วย", "กระจอก"];
    if (message && forbiddenWords.some((w) => message.includes(w))) {
      const angryText =
        "ขอโทษนะคะ ถ้าพูดจาไม่สุภาพแบบนี้ ดิฉันขออนุญาตวางสายทันทีค่ะ แล้วถ้ามีเรื่องต้องการติดต่อจริง ๆ รบกวนโทรเข้าช่องทางทางการจะเหมาะกว่านะคะ";
      return res.status(200).json({ text: angryText, forceDisconnect: true });
    }

    // ---------------------------
    // 2) Character config
    // ---------------------------
    const charConfig = {
      "1": {
        name: "คุณเปรมวดี",
        voice: "th-TH-PremwadeeNeural",
        rate: "0.92",
        pitch: "-1%",
        gender: "female",
        role: "คนปกติที่กำลังยุ่ง ไม่รู้ว่าจะโดนขายประกัน ใจดีแต่มีขอบเขต",
        style:
          "พูดสุภาพ นุ่มนวล แต่ชัดเจน ใช้คำเชื่อมแบบคนจริง เช่น 'เอ่อ...', 'อ๋อ...', 'คือว่า...', 'พอดีว่า...' และถามกลับเพื่อความมั่นใจ",
      },
      "2": {
        name: "คุณสมเกียรติ",
        voice: "th-TH-NiwatNeural",
        rate: "0.92",
        pitch: "0%",
        gender: "male",
        role: "พนักงานออฟฟิศ เน้นเหตุผล ขี้สงสัย ไม่ชอบคนพูดรัวๆ",
        style:
          "พูดเป็นงานเป็นการ สุภาพ ชอบถามย้อนกลับเพื่อขอข้อมูลให้ชัด เช่น 'ไม่ทราบว่าติดต่อเรื่องอะไรครับ?' 'ขอรายละเอียดสั้น ๆ ได้ไหมครับ?'",
      },
      "3": {
        name: "คุณฤทัย",
        voice: "th-TH-AcharaNeural",
        rate: "0.94",
        pitch: "+2%",
        gender: "female",
        role: "แม่บ้านใจร้อน ยุ่งอยู่กับลูก ถ้าพูดไม่รู้เรื่องจะตัดบททันที",
        style:
          "พูดเร็วขึ้นเล็กน้อย ดูรีบ แต่ยังสุภาพ ใช้คำตัดบทแบบจริง เช่น 'พอดีรีบอยู่ค่ะ ขอประเด็นหลัก ๆ ได้ไหมคะ?'",
      },
      "4": {
        name: "คุณฐิติกร",
        voice: "th-TH-NiwatNeural",
        rate: "0.90",
        pitch: "-10%",
        gender: "male",
        role: "ผู้บริหารระดับสูง สุขุม มีเวลาให้จำกัด",
        style:
          "พูดนิ่ง สุภาพ กระชับแต่ไม่ห้วน ให้กรอบเวลา ชอบถามให้เข้าประเด็น เช่น 'สรุปให้ผมหน่อยครับว่าต้องการอะไร?'",
      },
    };

    const char = charConfig[String(level)] || charConfig["1"];
    const honor = char.gender === "male" ? "ครับ/ครับผม" : "ค่ะ/คะ";

    // ---------------------------
    // 3) Gemini URL
    // ---------------------------
    const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    // ---------------------------
    // 4) Ending Evaluation Mode (JSON only)
    // ---------------------------
    if (isEnding) {
      const evalPrompt =
        `คุณคือหัวหน้าเทรนเนอร์ Telesales มืออาชีพ ประเมินบทสนทนาตามเกณฑ์ 17 ข้อ ` +
        `ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น: ` +
        `{"score":0-85,"strengths":"...","weaknesses":"...","detail_breakdown":[{"topic":"...","stars":0-5}]}`;

      const gRes = await fetch(gUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: normalizeHistoryToGemini(history),
          system_instruction: { parts: [{ text: evalPrompt }] },
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.1,
            max_output_tokens: 600,
          },
        }),
      });

      const gData = await gRes.json();
      const raw = gData?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // fallback กันกรณี AI ส่ง JSON ไม่สมบูรณ์
        parsed = {
          score: 0,
          strengths: "",
          weaknesses: "",
          detail_breakdown: [],
          raw,
        };
      }

      return res.status(200).json({ evaluation: parsed });
    }

    // ---------------------------
    // 5) System Prompt (Human-like)
    // ---------------------------
    const systemPrompt = `
คุณคือ ${char.name} (${char.role})
สไตล์การพูด: ${char.style}

กฎเหล็กในการตอบ (Strict Rules):
1) ห้ามตอบห้วน ต้องเหมือนคุยโทรศัพท์จริง
2) ใช้คำเชื่อมแบบธรรมชาติ เช่น "อ๋อ...", "เอ่อ...", "คือว่า...", "พอดีว่า..." อย่างพอดี
3) ภาษาไทย 100% ห้ามภาษาอังกฤษ
4) ห้ามวงเล็บทุกชนิด และห้ามสัญลักษณ์พิเศษ/มาร์กดาวน์/หัวข้อย่อย/ลิสต์
5) ต้องมีหางเสียง ${honor} ให้เหมาะกับจังหวะ
6) ความยาวขั้นต่ำ: 4-7 ประโยค (ประมาณ 70-140 คำ) เพื่อความสมจริง
7) ต้องมี "คำถามต่อยอด" อย่างน้อย 1 ข้อทุกครั้ง เพื่อให้บทสนทนาต่อเนื่อง
8) ต้องมี "สะท้อนความเข้าใจ" ตอนต้น 1 ส่วน เช่น "อ๋อ เข้าใจค่ะว่า..." หรือ "เอ่อ หมายถึงว่า..."
9) น้ำเสียงต้องเป็นคนจริง: มีการขอให้ชัดเจน, ขอชื่อ/ที่มา, ขอประเด็น, และกำหนดเวลาได้ถ้ากำลังยุ่ง

แนวทางโครงสร้างคำตอบแบบเนียน:
- รับสาย + เช็คว่าใคร/จากที่ไหน
- สะท้อนสิ่งที่ได้ยิน + บอกสถานะ/เวลาที่สะดวก
- ถามต่อยอดให้ผู้โทรตอบ
`;

    // ---------------------------
    // 6) Build contents
    // ---------------------------
    const contents = normalizeHistoryToGemini(history).concat([
      { role: "user", parts: [{ text: String(message) }] },
    ]);

    // ---------------------------
    // 7) Ask Gemini
    // ---------------------------
    const gRes = await fetch(gUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        system_instruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 0.8,
          top_p: 0.9,
          max_output_tokens: 700,
        },
      }),
    });

    const gData = await gRes.json();
    const aiRaw = gData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!aiRaw) throw new Error("AI No Response");

    // ---------------------------
    // 8) Clean text
    // ---------------------------
    let cleanText = cleanOutputText(aiRaw);

    // กันคำตอบสั้นผิดปกติแบบสุด ๆ (เผื่อหลุด)
    // ถ้าสั้นกว่า 35 คำ ให้เติม prompt สั้น ๆ รอบเดียว (ไม่ถาม user เพิ่ม)
    const wordCount = cleanText.split(" ").filter(Boolean).length;
    if (wordCount < 35) {
      const expandPrompt =
        `ขยายคำตอบให้เป็นบทพูดที่เป็นธรรมชาติ 4-7 ประโยค ` +
        `มีคำเชื่อมแบบคนจริง และลงท้ายด้วยคำถามต่อยอด 1 ข้อ ` +
        `ห้ามใช้วงเล็บ ห้ามมาร์กดาวน์ ภาษาไทยล้วน`;

      const gRes2 = await fetch(gUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: contents.concat([{ role: "user", parts: [{ text: expandPrompt }] }]),
          system_instruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            temperature: 0.75,
            top_p: 0.9,
            max_output_tokens: 700,
          },
        }),
      });

      const gData2 = await gRes2.json();
      const aiRaw2 = gData2?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (aiRaw2) cleanText = cleanOutputText(aiRaw2);
    }

    // ---------------------------
    // 9) Azure TTS
    // ---------------------------
    const ssmlText = addNaturalPausesForSSML(escapeXml(cleanText));

    const ssml = `<speak version="1.0" xml:lang="th-TH">
      <voice xml:lang="th-TH" name="${char.voice}">
        <prosody rate="${char.rate}" pitch="${char.pitch}">
          ${ssmlText}
        </prosody>
      </voice>
    </speak>`;

    const azRes = await fetch(
      `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": azureKey,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
        },
        body: ssml,
      }
    );

    if (!azRes.ok) {
      const errText = await azRes.text().catch(() => "");
      throw new Error("Azure TTS Error: " + errText);
    }

    const audioBuffer = await azRes.arrayBuffer();

    return res.status(200).json({
      text: cleanText,
      audio: Buffer.from(audioBuffer).toString("base64"),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
