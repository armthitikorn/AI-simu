export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send("Azure & Gemini Server Ready");

    const { message, history, gender, level = 1 } = req.body;

    try {
        // --- 1. ตั้งค่าระดับความยาก (System Instruction) ---
        let difficultyContext = "";
        if (level === 1) {
            difficultyContext = "[ระดับ: ลูกค้าใจดี] สุภาพ นิ่งๆ มั่นใจ";
        } else if (level === 2) {
            difficultyContext = "[ระดับ: ลูกค้าช่างเลือก] รอบคอบ ถามจี้จุด สงสัยในรายละเอียด";
        } else {
            difficultyContext = "[ระดับ: ลูกค้าสายแข็ง] มีอำนาจ ตัดสินใจเด็ดขาด ไม่ชอบคนพูดจาเวิ่นเว้อ";
        }

        const systemPrompt = `คุณคือ "คุณเปรมวดี" ลูกค้าที่จะมาฝึกพนักงานขาย
        กฎเหล็ก:
        1. ตรวจสอบการแนะนำตัว, เลขใบอนุญาต, และการขออัดเสียง
        2. บทบาท: ${difficultyContext}
        3. ห้ามใช้เครื่องหมายพิเศษ (* หรือ -) ให้ตอบเป็นประโยคพูดที่ลื่นไหลเท่านั้น`;

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

        // ล้างตัวอักษรส่วนเกิน
        let cleanText = aiText.replace(/[*#\-_]/g, '').replace(/\s+/g, ' ').trim();

        // --- 3. เรียกใช้ Microsoft Azure Speech พร้อมปรับแต่งน้ำเสียง (SSML) ---
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
            // ส่วนสำคัญ: ปรับ rate (ความเร็ว) และ pitch (ระดับเสียง) เพื่อให้ดูสมูทและมีอำนาจ
            body: `<speak version='1.0' xml:lang='th-TH'>
                    <voice xml:lang='th-TH' name='${voiceName}'>
                        <prosody rate="0.95" pitch="-5%">
                            ${cleanText}
                        </prosody>
                    </voice>
                  </speak>`
        });

        if (!azureResponse.ok) throw new Error("Azure TTS Error");

        const audioArrayBuffer = await azureResponse.arrayBuffer();
        const base64Audio = Buffer.from(audioArrayBuffer).toString('base64');

        res.status(200).json({ text: cleanText, audio: base64Audio });

    } catch (error) {
        console.error("Error:", error.message);
        res.status(500).json({ error: error.message });
    }
}
