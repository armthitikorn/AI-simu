export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send("AI Server is ready");

    const { message, history, gender } = req.body;

    try {
        if (!process.env.GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");

        // ใช้ v1beta เพราะรองรับฟีเจอร์ใหม่ๆ ได้ครบถ้วนที่สุด
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: (history || []).concat([{ role: "user", parts: [{ text: message }] }]),
                // เปลี่ยนจาก systemInstruction เป็น system_instruction (snake_case)
                system_instruction: { 
                    parts: [{ text: "คุณคือ AI Simulator อัจฉริยะ พูดไทยเป็นธรรมชาติ และโต้ตอบได้อย่างชาญฉลาด" }] 
                }
            })
        });

        const gData = await geminiResponse.json();

        // ตรวจสอบ Error จาก API
        if (gData.error) {
            console.error("Gemini API Error Detail:", gData.error);
            throw new Error(`Gemini API Error: ${gData.error.message}`);
        }

        if (!gData.candidates || !gData.candidates[0]) {
            throw new Error("AI ไม่ส่งคำตอบกลับมา กรุณาเช็ค API Key หรือ Quota");
        }

        const aiText = gData.candidates[0].content.parts[0].text;

        // เรียก ElevenLabs
        const voiceId = (gender === 'female') ? process.env.VOICE_ID_FEMALE : process.env.VOICE_ID_MALE;
        if (!voiceId) throw new Error("Missing Voice ID in Environment Variables");

        const voiceResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
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
            const vErr = await voiceResponse.json();
            throw new Error(`ElevenLabs Error: ${vErr.detail?.message || "Unknown Error"}`);
        }

        const audioArrayBuffer = await voiceResponse.arrayBuffer();
        const base64Audio = Buffer.from(audioArrayBuffer).toString('base64');

        res.status(200).json({ text: aiText, audio: base64Audio });

    } catch (error) {
        console.error("Server Failure:", error.message);
        res.status(500).json({ error: error.message });
    }
}
