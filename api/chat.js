export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send("Simulator Online");

    const { message, history, level = 1 } = req.body;

    try {
        // --- 1. สั่งสมอง (Gemini) ให้เป็นผู้หญิง 100% ---
        const systemPrompt = `คุณคือ "คุณเปรมวดี" ลูกค้าผู้หญิงที่มีความภูมิฐาน (ระดับความยาก ${level})
        
**กฎเหล็กในการพูด:**
- คุณเป็นผู้หญิง: ต้องพูด "ค่ะ" หรือ "คะ" เท่านั้น **ห้ามพูดคำว่า "ครับ" โดยเด็ดขาด**
- ห้ามใส่คำบรรยายอารมณ์หรือท่าทางในวงเล็บ เช่น (ถอนหายใจ) หรือ (สงสัย)
- ห้ามใช้เครื่องหมายดอกจัน (*) หรือสัญลักษณ์พิเศษ ให้ส่งมาเฉพาะ "ข้อความคำพูด" เท่านั้น
- ถ้าพนักงานขายทำผิดกฎ คปภ. ให้ทักท้วงด้วยความระแวงแบบลูกค้าจริงๆ`;

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

        // --- 🛠️ 2. ส่วนการล้างข้อมูล (Text Cleaning) เพื่อป้องกันเสียงเพี้ยน ---
        let cleanText = aiText
            .replace(/\(.*?\)/g, '')       // ลบข้อความในวงเล็บกลม (...)
            .replace(/\[.*?\]/g, '')       // ลบข้อความในวงเล็บเหลี่ยม [...]
            .replace(/ครับ/g, 'ค่ะ')         // ดักจับคำว่า "ครับ" เปลี่ยนเป็น "ค่ะ" (เผื่อ AI พลาด)
            .replace(/นะกั๊บ/g, 'ค่ะ')        // ดักจับคำเลียนเสียงอื่นๆ
            .replace(/[*#\-_]/g, '')       // ลบเครื่องหมายพิเศษ
            .replace(/\s+/g, ' ')          // ยุบช่องว่างเยอะๆ
            .trim();

        // --- 3. ส่งไปให้คุณเปรมวดีพูด (Azure TTS) ---
        const azureResponse = await fetch(`https://${process.env.AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': process.env.AZURE_API_KEY,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3'
            },
            body: `<speak version='1.0' xml:lang='th-TH'>
                    <voice xml:lang='th-TH' name='th-TH-PremwadeeNeural'>
                        <prosody rate="1.0" pitch="-3%">
                            ${cleanText}
                        </prosody>
                    </voice>
                  </speak>`
        });

        const audioBuffer = await azureResponse.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString('base64');

        // ส่ง aiText ไปโชว์ในแชท แต่ส่ง base64Audio ที่ล้างแล้วไปให้หูฟัง
        res.status(200).json({ text: aiText, audio: base64Audio });

    } catch (e) {
        console.error("Error:", e.message);
        res.status(500).json({ error: e.message });
    }
}
