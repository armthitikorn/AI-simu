export default async function handler(req, res) {
    // ป้องกันการเรียกด้วย GET (ต้องใช้ POST เท่านั้น)
    if (req.method !== 'POST') {
        return res.status(200).send("API is ready. Please use POST to communicate.");
    }

    const { message, history } = req.body;

    try {
        // 1. ตรวจสอบ API Keys ก่อนเริ่ม
        if (!process.env.GEMINI_API_KEY || !process.env.ELEVENLABS_API_KEY) {
            return res.status(500).json({ error: "ลืมตั้งค่า API Key ใน Vercel Settings ครับ" });
        }

        // 2. เรียก Gemini 2.5 Flash
        // หมายเหตุ: หาก gemini-2.5-flash ยังไม่รองรับ ให้ลองเปลี่ยนเป็น gemini-1.5-flash
        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: history.concat([{ role: "user", parts: [{ text: message }] }]),
                systemInstruction: { parts: [{ text: "คุณคือ AI Simulator ที่พูดจาสมจริงมาก น้ำเสียงเป็นธรรมชาติ และโต้ตอบเป็นภาษาไทยอย่างเป็นกันเอง" }] }
            })
        });

        const gData = await geminiResponse.json();

        // ตรวจสอบว่า Gemini ส่ง Error กลับมาไหม
        if (gData.error) {
            console.error("Gemini API Error:", gData.error.message);
            return res.status(500).json({ error: "Gemini Error: " + gData.error.message });
        }

        if (!gData.candidates || gData.candidates.length === 0) {
            return res.status(500).json({ error: "Gemini ไม่ส่งคำตอบกลับมา (อาจติด Safety Filter)" });
        }

        const aiText = gData.candidates[0].content.parts[0].text;

        // 3. ส่งไป ElevenLabs
        const voiceResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': process.env.ELEVENLABS_API_KEY
            },
            body: JSON.stringify({
                text: aiText,
                model_id: "eleven_multilingual_v2",
                voice_settings: { stability: 0.5, similarity_boost: 0.8 }
            })
        });

        if (!voiceResponse.ok) {
            const voiceError = await voiceResponse.json();
            return res.status(500).json({ error: "ElevenLabs Error: " + (voiceError.detail?.status || "Unknown") });
        }

        const audioArrayBuffer = await voiceResponse.arrayBuffer();
        const base64Audio = Buffer.from(audioArrayBuffer).toString('base64');

        res.status(200).json({ text: aiText, audio: base64Audio });

    } catch (error) {
        console.error("Server Crash:", error);
        res.status(500).json({ error: "เกิดข้อผิดพลาดที่ Server: " + error.message });
    }
}
