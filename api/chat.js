export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send("Simulator API Ready");
    const { message, history, level, isEnding } = req.body;

    try {
        // --- 🤖 โหมดประเมินผล (AI Trainer) ---
        if (isEnding) {
            const evalPrompt = `คุณคือหัวหน้าฝ่ายฝึกอบรมพนักงานขายประกันทางโทรศัพท์ (Telesales Trainer)
            จงวิเคราะห์ประวัติการสนทนาที่ให้มา โดยประเมินตามเกณฑ์: 
            1. คปภ. Compliance (แจ้งชื่อ, เลขใบอนุญาต, ขออัดเสียง) 
            2. น้ำเสียงและมารยาท 
            3. การแก้ปัญหา
            ตอบกลับเป็น JSON เท่านั้น: 
            {"score": 0-100, "strengths": "...", "weaknesses": "...", "tone_feedback": "..."}`;

            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
            const gRes = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: history,
                    system_instruction: { parts: [{ text: evalPrompt }] },
                    generationConfig: { response_mime_type: "application/json" }
                })
            });

            const gData = await gRes.json();
            const evaluation = JSON.parse(gData.candidates[0].content.parts[0].text);
            return res.status(200).json({ evaluation });
        }

        // --- 👩‍💼 โหมดลูกค้า (คุณเปรมวดี) ---
        const systemPrompt = `คุณคือ "คุณเปรมวดี" ลูกค้าผู้หญิงที่มีความภูมิฐานและสุขุม (ระดับ ${level})
        กฎเหล็ก: ห้ามใช้คำว่า "ครับ", พูดเฉพาะ "ค่ะ/คะ", ห้ามใส่สัญลักษณ์หรือข้อความในวงเล็บเด็ดขาด
        ความเป็นธรรมชาติ: พูดจาช้าๆ นิ่งๆ สุภาพแต่มีอำนาจ ตอบเป็นประโยคที่คนจริงๆ พูดคุยกัน`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const gRes = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: (history || []).concat([{ role: "user", parts: [{ text: message }] }]),
                system_instruction: { parts: [{ text: systemPrompt }] }
            })
        });

        const gData = await gRes.json();
        const aiText = gData.candidates[0].content.parts[0].text;
        const cleanText = aiText.replace(/\(.*?\)/g, '').replace(/ครับ/g, 'ค่ะ').replace(/[*#\-_]/g, '').trim();

        const azureResponse = await fetch(`https://${process.env.AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': process.env.AZURE_API_KEY,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3'
            },
            body: `<speak version='1.0' xml:lang='th-TH'><voice xml:lang='th-TH' name='th-TH-PremwadeeNeural'><prosody rate="0.88" pitch="-3%">${cleanText}</prosody></voice></speak>`
        });

        const audioBuffer = await azureResponse.arrayBuffer();
        res.status(200).json({ text: aiText, audio: Buffer.from(audioBuffer).toString('base64') });

    } catch (e) { res.status(500).json({ error: e.message }); }
}
