export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send("Server is ready");

    const { message, history, gender } = req.body;

    try {
        // 1. เรียกใช้ Gemini (เปลี่ยนเป็น 1.5-flash เพื่อความเสถียรสูงสุดในปัจจุบัน)
        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: history.concat([{ role: "user", parts: [{ text: message }] }]),
                systemInstruction: { parts: [{ text: "คุณคือ AI Simulator พูดไทยเป็นธรรมชาติ และโต้ตอบสั้นๆ อย่างเป็นกันเอง" }] }
            })
        });

        const gData = await geminiResponse.json();

        // --- จุดเช็ค Error ของ Gemini ---
        if (gData.error) {
            console.error("Gemini Error Detail:", gData.error);
            throw new Error(`Gemini API Error: ${gData.error.message}`);
        }

        if (!gData.candidates || gData.candidates.length === 0) {
            console.error("Gemini Response Full Data:", JSON.stringify(gData));
            throw new Error("Gemini ไม่ส่งคำตอบกลับมา (Check API Key หรือโควตา)");
        }

        const aiText = gData.candidates[0].content.parts[0].text;

        // 2. เรียก ElevenLabs
        const voiceId = (gender === 'female') ? process.env.VOICE_ID_FEMALE : process.env.VOICE_ID_MALE;
        
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
            const vError = await voiceResponse.json();
            throw new Error(`ElevenLabs Error: ${JSON.stringify(vError)}`);
        }

        const audioArrayBuffer = await voiceResponse.arrayBuffer();
        const base64Audio = Buffer.from(audioArrayBuffer).toString('base64');

        res.status(200).json({ text: aiText, audio: base64Audio });

    } catch (error) {
        console.error("Server Error:", error.message);
        res.status(500).json({ error: error.message });
    }
}
