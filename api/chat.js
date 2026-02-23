export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message = "", history = [], level = "1" } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  const azureKey = process.env.AZURE_API_KEY;
  const azureRegion = process.env.AZURE_REGION || "southeastasia";

  try {
    // ฟังก์ชันช่วยจัดการตัวอักษรพิเศษ ป้องกัน SSML พัง
    const escapeXml = (unsafe) => {
      return unsafe.replace(/[<>&"']/g, (c) => {
        switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case '"': return '&quot;';
          case "'": return '&apos;';
          default: return c;
        }
      });
    };

    const addAdvancedSSML = (text) => {
      let safeText = escapeXml(text);
      return safeText
        .replace(/([?!\.])/g, `$1<break time="300ms"/>`)
        .replace(/(ครับ|ค่ะ|คะ|นะครับ|นะคะ)/g, `$1<break time="180ms"/>`)
        .replace(/(เอ่อ|คือว่า|อืม|อ๋อ)/g, `<prosody pitch="-5%">$1</prosody><break time="150ms"/>`);
    };

    const charConfig = {
      "1": { name: "คุณเปรมวดี", role: "พนักงานบริษัทวัยกลางคน", trait: "ใจดี สุภาพ แต่ยุ่งมาก ชอบพูดแทรกว่า 'ค่ะๆ ฟังอยู่ค่ะ' แต่ในใจอยากวางสาย", voice: "th-TH-PremwadeeNeural", rate: "1.0", pitch: "0%" },
      "2": { name: "คุณสมเกียรติ", role: "เจ้าของธุรกิจขี้ระแวง", trait: "เน้นตัวเลข พูดจาโผงผาง ชอบถามจี้จุด และขี้รำคาญคนพูดอ้อมค้อม", voice: "th-TH-NiwatNeural", rate: "0.95", pitch: "-3%" },
      "3": { name: "น้องฟ้า", role: "คุณแม่ลูกอ่อนสุดสตรอง", trait: "เสียงเหนื่อยๆ มีภาระเยอะ จะตัดบททันทีถ้าคนขายพูดไม่เข้าเรื่อง", voice: "th-TH-AcharaNeural", rate: "1.05", pitch: "+2%" },
      "4": { name: "คุณอิทธิพล", role: "ผู้บริหารระดับสูง", trait: "นิ่ง สุขุม พูดน้อยแต่ถามกลับแรงๆ ชอบเปรียบเทียบผลประโยชน์", voice: "th-TH-NiwatNeural", rate: "0.85", pitch: "-8%" },
      "5": { name: "อาม่ากิมฮวย", role: "ผู้สูงอายุใจดีขี้เหงา", trait: "พูดช้า หูไม่ค่อยดี ชอบเล่าเรื่องลูกหลานสลับกับเรื่องประกัน", voice: "th-TH-AcharaNeural", rate: "0.80", pitch: "-5%" }
    };

    const char = charConfig[String(level)] || charConfig["1"];

    const systemPrompt = `
คุณคือ ${char.name} (${char.role}) นิสัย: ${char.trait}
กฎเหล็ก (Strict Rules):
1. **ต้องพูดให้จบประโยค**: ห้ามหยุดพูดกลางคันเด็ดขาด ต้องจบความคิดให้สมบูรณ์
2. **หางเสียง**: ต้องมีหางเสียง (ครับ/ค่ะ) ปิดท้ายประโยคสุดท้ายเสมอ
3. **ความเป็นมนุษย์**: ใช้คำเชื่อมแบบคนจริงๆ เช่น "คือว่า...", "เอ่อ...พอดี..." ให้ดูเป็นธรรมชาติ
4. **ห้ามใช้วงเล็บ**: ห้ามใส่ท่าทางในวงเล็บเด็ดขาด ให้สื่อสารผ่านคำพูดเท่านั้น
5. **ห้ามภาษาอังกฤษ**: ใช้ภาษาไทย 100% 
6. **ความยาว**: ตอบประมาณ 3-5 ประโยคเพื่อให้การสนทนามีเนื้อหาเพียงพอ
`;

    const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${apiKey}`;

    const gRes = await fetch(gUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: history.slice(-10).concat([{ role: "user", parts: [{ text: message }] }]),
        system_instruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 0.8,
          top_p: 0.95,
          max_output_tokens: 1024, // เพิ่ม Token ให้เพียงพอสำหรับการจบประโยค
          // ลบ stop_sequences ออกเพื่อป้องกันการตัดคำก่อนกำหนด
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" }
        ]
      }),
    });

    const gData = await gRes.json();
    let aiRaw = gData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!aiRaw) throw new Error("AI No Response");

    const cleanText = aiRaw.replace(/[*#_`]/g, "").trim();

    // ---------------------------------------------------------
    // Azure TTS
    // ---------------------------------------------------------
    const ssml = `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="th-TH">
        <voice name="${char.voice}">
          <prosody rate="${char.rate}" pitch="${char.pitch}">
            ${addAdvancedSSML(cleanText)}
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

    if (!azRes.ok) throw new Error(`Azure TTS Error: ${azRes.statusText}`);

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
