// วางไฟล์นี้ในโฟลเดอร์ /api/chat.js
export default async function handler(req, res) {
    const { message, history } = req.body;

    // 1. คุยกับ Gemini 2.5 Flash
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [...history, { role: "user", parts: [{ text: message }] }],
            systemInstruction: "คุณเป็นคู่สนทนาที่สมจริงมาก พูดจาเหมือนคนจริงๆ มีอารมณ์ขันและเห็นอกเห็นใจ ใช้ภาษาเป็นกันเอง"
        })
    });
    const data = await geminiResponse.json();
    const aiText = data.candidates[0].content.parts[0].text;

    // 2. ส่งข้อความไปแปลงเป็นเสียงที่ ElevenLabs
    const voiceResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/YOUR_VOICE_ID`, {
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

    const audioBuffer = await voiceResponse.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');

    res.status(200).json({ text: aiText, audio: base64Audio });
}
