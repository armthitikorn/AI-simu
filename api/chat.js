export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send("Azure & Gemini Server Ready");

    const { message, history, gender, level = 1 } = req.body;

    try {
        // --- 1. สั่ง Gemini ให้เลิกใส่คำบรรยายอารมณ์ ---
        const systemPrompt = `คุณคือ "คุณเปรมวดี" ลูกค้าที่จะมาฝึกพนักงานขาย
        
**บทบาทของคุณ:**
- คุณคือคนจริงๆ ที่รับโทรศัพท์ ไม่รู้มาก่อนว่าจะถูกขายประกัน
- **กฎสำคัญ:** ห้ามใส่คำบรรยายอารมณ์หรือท่าทางในวงเล็บ เช่น (สงสัย) หรือ (ยิ้ม) ให้ตอบเฉพาะ "คำพูด" ที่จะออกจากปากจริงๆ เท่านั้น
- ความเป็นธรรมชาติ: ใช้คำว่า "ค่ะ", "นะคะ", "เอ่อ", "คือ" ได้ตามสถานการณ์จริง
- ถ้าพนักงานทำไม่ถูกกฎ คปภ. (ชื่อ/ใบอนุญาต/อัดเสียง) ให้ถามด้วยความระแวงแบบคนปกติ ไม่ใช่บอทตรวจข้อสอบ

**ระดับอารมณ์:** ปัจจุบันคือเลเวล ${level}`;

        // --- 2. เรียกใช้ Gemini 2.5 Flash ---
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: (history || []).concat([{ role: "user", parts: [{ text: message }] }]),
                system_instruction: { parts: [{ text: systemPrompt }] }
            })
        });

        const gData = await geminiResponse.json();
        const aiText = gData.candidates[0].content.parts[0].text;

        // --- 🛠️ ส่วนที่เพิ่มใหม่: ล้างวงเล็บและสัญลักษณ์พิเศษ ---
        let cleanText = aiText
            .replace(/\(.*?\)/g, '')   // ลบข้อความในวงเล็บกลม (...) ออกทั้งหมด
            .replace(/\[.*?\]/g, '')   // ลบข้อความในวงเล็บเหลี่ยม [...] ออกทั้งหมด
            .replace(/[*#\-_]/g, '')   // ลบเครื่องหมายพิเศษอื่นๆ
            .replace(/\s+/g, ' ')      // ยุบช่องว่าง
            .trim();

        // --- 3. เรียกใช้ Microsoft Azure Speech ---
        const azureRegion = process.env.AZURE_REGION || 'southeastasia';
        const azureKey = process.env.AZURE_API_KEY;
        const voiceName = (gender === 'male') ? 'th-TH-NiwatNeural' : 'th-TH-PremwadeeNeural';

        const azureResponse = await fetch(`https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': azureKey,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3'
            },
            body: `<speak version='1.0' xml:lang='th-TH'>
                    <voice xml:lang='th-TH' name='${voiceName}'>
                        <prosody rate="1.0" pitch="-3%">
                            ${cleanText}
                        </prosody>
                    </voice>
                  </speak>`
        });

        const audioArrayBuffer = await azureResponse.arrayBuffer();
        const base64Audio = Buffer.from(audioArrayBuffer).toString('base64');

        // ส่งข้อความดิบ (aiText) กลับไปโชว์ในแชท แต่ส่งเสียง (cleanText) ไปให้ฟัง
        res.status(200).json({ text: aiText, audio: base64Audio });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
