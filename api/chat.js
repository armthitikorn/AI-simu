export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send("Azure & Gemini Server Ready");

    const { message, history, gender, level = 1 } = req.body;

    try {
        // --- 1. ตั้งค่าระดับความยาก (System Instruction) ---
        let difficultyContext = "";
        if (level === 1) {
            difficultyContext = "[ระดับ: ลูกค้าใจดี] สุภาพ คุยง่าย สนใจประกันออมเงิน/ลดหย่อนภาษี";
        } else if (level === 2) {
            difficultyContext = "[ระดับ: ลูกค้าช่างเลือก] รอบคอบ ถามละเอียดเรื่องสุขภาพและประกันสะสมทรัพย์";
        } else {
            difficultyContext = "[ระดับ: ลูกค้าสายแข็ง] ยุ่งมาก ปฏิเสธเก่ง มีอคติกับประกัน";
        }

        // ปรับ Prompt ให้ Gemini ห้ามใส่เครื่องหมายพิเศษ
        const systemPrompt = `คุณคือ "คุณเปรมวดี" ลูกค้าฝึกขายประกัน
        กฎเหล็ก:
        1. ตรวจสอบการแนะนำตัว, เลขใบอนุญาต, และการขออัดเสียง
        2. บทบาทของคุณคือ: ${difficultyContext}
        3. สำคัญมาก: ห้ามใช้เครื่องหมายดอกจัน (*) หรือสัญลักษณ์พิเศษในข้อความ ให้ตอบเป็นข้อความธรรมดาที่คนพูดกันจริงๆ เท่านั้น`;

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
        let aiText = gData.candidates[0].content.parts[0].text;

        // --- 🛠️ ส่วนที่เพิ่มใหม่: ล้างตัวอักษรส่วนเกินให้ AI พูดลื่นขึ้น ---
        // ลบเครื่องหมาย * (ที่มักมากับตัวหนา), ลบเครื่องหมาย -, ลบช่องว่างส่วนเกิน
        let cleanText = aiText.replace(/[*#\-_]/g, '') // ลบดอกจัน, สี่เหลี่ยม, ขีดกลาง, ขีดล่าง
                             .replace(/\s+/g, ' ')    // ยุบช่องว่างเยอะๆ ให้เหลือช่องเดียว
                             .trim();                 // ตัดช่องว่างหน้า-หลัง

        // --- 3. เรียกใช้ Microsoft Azure Speech ---
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
            // ใช้ cleanText แทน aiText เพื่อความลื่นไหล
            body: `<speak version='1.0' xml:lang='th-TH'><voice xml:lang='th-TH' name='${voiceName}'>${cleanText}</voice></speak>`
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
