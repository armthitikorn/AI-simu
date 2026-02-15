export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).send("AI Server is running!");
    }

    const { message, history, gender } = req.body;

    try {
        // 1. เรียกใช้ Gemini 2.5 Flash เป็นสมอง
        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: history.concat([{ role: "user", parts: [{ text: message }] }]),
                systemInstruction: { 
                    parts: [{ text: "คุณคือ AI Simulator ที่พูดจาสมจริงมาก น้ำเสียงเป็นธรรมชาติ และโต้ตอบเป็นภาษาไทยอย่างเป็นกันเองที่สุด" }] 
                }
            })
        });

        const gData = await geminiResponse.json();
        const aiText = gData.candidates[0].content.parts[0].text;

        // 2. เลือก Voice ID (ชาย หรือ หญิง)
        const voiceId = (gender === 'female') 
            ? process.env.VOICE_ID_FEMALE 
            : process.env.VOICE_ID_MALE;

        // 3. ส่งไปแปลงเสียงที่ ElevenLabs (Multilingual v2)
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

        const audioArrayBuffer = await voiceResponse.arrayBuffer();
        const base64Audio = Buffer.from(audioArrayBuffer).toString('base64');

        // ส่งทั้งข้อความและเสียงกลับไป
        res.status(200).json({ text: aiText, audio: base64Audio });

    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Server Error" });
    }
}
