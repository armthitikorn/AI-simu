export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send("API Online");
    const { message, history, level, isEnding } = req.body;

    try {
        // --- 🤖 โหมดประเมินผล ---
        if (isEnding) {
            const evalPrompt = `คุณคือหัวหน้าเทรนเนอร์ Telesales มืออาชีพ จงประเมินบทสนทนานี้เป็น JSON: 
            {"score": 0-100, "strengths": "จุดเด่น", "weaknesses": "จุดที่ต้องแก้", "tone_feedback": "วิเคราะห์น้ำเสียง"}
            เกณฑ์: คปภ. (ชื่อ/ใบอนุญาต/อัดเสียง), ความสุภาพ, การแก้ปัญหา`;

            const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
            const gRes = await fetch(gUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: history,
                    system_instruction: { parts: [{ text: evalPrompt }] },
                    generationConfig: { response_mime_type: "application/json" }
                })
            });
            const gData = await gRes.json();
            return res.status(200).json({ evaluation: JSON.parse(gData.candidates[0].content.parts[0].text) });
        }

        // --- 👩‍💼 โหมดลูกค้า (4 ตัวละคร) ---
        const charConfig = {
            "1": { name: "คุณเปรมวดี", voice: "th-TH-PremwadeeNeural", rate: "0.88", pitch: "-3%", gender: "female", role: "ใจดี สุภาพ" },
            "2": { name: "คุณสมเกียรติ", voice: "th-TH-NiwatNeural", rate: "0.92", pitch: "-2%", gender: "male", role: "เน้นเหตุผล ถามจี้" },
            "3": { name: "คุณฤทัย", voice: "th-TH-AcharaNeural", rate: "1.05", pitch: "+2%", gender: "female", role: "ใจร้อน ยุ่งมาก" },
            "4": { name: "คุณฐิติกร", voice: "th-TH-NiwatNeural", rate: "0.85", pitch: "-8%", gender: "male", role: "ผู้บริหาร มีอำนาจ กดดัน" }
        };

        const char = charConfig[level] || charConfig["1"];
        const systemPrompt = `คุณคือ ${char.name} (${char.role}) เป็นเพศ ${char.gender === 'male' ? 'ชาย (ครับ)' : 'หญิง (ค่ะ/คะ)'} 
        ห้ามใช้คำลงท้ายผิดเพศ, ห้ามใส่ข้อความในวงเล็บ, ตอบเป็นประโยคที่คนจริงๆ พูดตามบุคลิก ${char.role}`;

        const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const gRes = await fetch(gUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: (history || []).concat([{ role: "user", parts: [{ text: message }] }]),
                system_instruction: { parts: [{ text: systemPrompt }] }
            })
        });

        const gData = await gRes.json();
        const aiText = gData.candidates[0].content.parts[0].text;

        // ล้างตัวหนังสือ
        let cleanText = aiText.replace(/\(.*?\)/g, '').replace(/[*#\-_]/g, '').trim();
        if (char.gender === 'female') cleanText = cleanText.replace(/ครับ/g, 'ค่ะ');
        if (char.gender === 'male') cleanText = cleanText.replace(/ค่ะ|คะ/g, 'ครับ');

        const azRes = await fetch(`https://${process.env.AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
            method: 'POST',
            headers: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_API_KEY, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3' },
            body: `<speak version='1.0' xml:lang='th-TH'><voice xml:lang='th-TH' name='${char.voice}'><prosody rate="${char.rate}" pitch="${char.pitch}">${cleanText}</prosody></voice></speak>`
        });

        const audioBuffer = await azRes.arrayBuffer();
        res.status(200).json({ text: aiText, audio: Buffer.from(audioBuffer).toString('base64') });

    } catch (e) { res.status(500).json({ error: e.message }); }
}
