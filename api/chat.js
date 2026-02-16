export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send("Simulator Online");
    const { message, history, level } = req.body;

    try {
        const systemPrompt = `คุณคือ "คุณเปรมวดี" ลูกค้าผู้หญิงที่มีความภูมิฐานและสุขุม
        กฎสำคัญ:
        - ห้ามใช้คำว่า "ครับ", พูดเฉพาะ "ค่ะ/คะ"
        - ห้ามใส่ข้อความในวงเล็บ หรือสัญลักษณ์พิเศษ
        - ตอบเป็นประโยคที่สั้น กระชับ และเป็นธรรมชาติเหมือนคนคุยกันจริงๆ ไม่ต้องรีบตอบ
        - บทบาท: ปัจจุบันคือระดับความยากที่ ${level}`;

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

        // ล้างคำในวงเล็บ และ เปลี่ยน "ครับ" เป็น "ค่ะ"
        const cleanText = aiText.replace(/\(.*?\)/g, '').replace(/ครับ/g, 'ค่ะ').replace(/[*#\-_]/g, '').trim();

        const azureResponse = await fetch(`https://${process.env.AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': process.env.AZURE_API_KEY,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3'
            },
            // 🎙️ จุดที่ปรับความเร็ว: rate="0.88" คือช้าลงให้ฟังทันและดูใจเย็น
            body: `<speak version='1.0' xml:lang='th-TH'>
                    <voice xml:lang='th-TH' name='th-TH-PremwadeeNeural'>
                        <prosody rate="0.88" pitch="-3%">
                            ${cleanText}
                        </prosody>
                    </voice>
                  </speak>`
        });

        const audioBuffer = await azureResponse.arrayBuffer();
        res.status(200).json({ text: aiText, audio: Buffer.from(audioBuffer).toString('base64') });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}
