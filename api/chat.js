export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send("API Online");
    const { message, history, level, isEnding } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;
    const azureKey = process.env.AZURE_API_KEY;
    const azureRegion = process.env.AZURE_REGION || 'southeastasia';

    try {
        // --- 🤖 โหมดประเมินผล (อ้างอิงไฟล์ PDF 17 ข้อ) ---
        if (isEnding) {
            const evalPrompt = `คุณคือหัวหน้าเทรนเนอร์ Telesales มืออาชีพ จงประเมินบทสนทนาตามเกณฑ์ 17 ข้อ (ข้อละ 5 ดาว คะแนนเต็ม 85)
            หัวข้อ: 1.ชื่อ-สกุล 2.เลขใบอนุญาต 3.ชื่อบริษัท 4.ขออัดเสียง 5.บทเชื่อมโยง 6.ผลประโยชน์ 7.ค่าเบี้ย 8.มูลค่ากรมธรรม์ 9.ภาษี 10.ตอบข้อโต้แย้ง 11.การสมัคร/ชำระเงิน 12.ปิดการขาย 3 ครั้ง 13.สคริปต์รวม 14.น้ำเสียง 15.การคุมสถานการณ์ 16.ไหวพริบ 17.ศักยภาพ
            ตอบกลับเป็น JSON: {"score": 0-85, "strengths": "...", "weaknesses": "...", "detail_breakdown": [{"topic": "...", "stars": 0-5}]}`;

            const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
            const gRes = await fetch(gUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: history,
                    system_instruction: { parts: [{ text: evalPrompt }] },
                    generationConfig: { response_mime_type: "application/json", temperature: 0.1 }
                })
            });
            const gData = await gRes.json();
            const evaluation = JSON.parse(gData.candidates[0].content.parts[0].text);
            return res.status(200).json({ evaluation });
        }

        // --- 👩‍💼 โหมดลูกค้า (4 ตัวละคร) ---
        const charConfig = {
            "1": { name: "คุณเปรมวดี", voice: "th-TH-PremwadeeNeural", rate: "0.88", pitch: "-3%", gender: "female", role: "ใจดี สุภาพ" },
            "2": { name: "คุณสมเกียรติ", voice: "th-TH-NiwatNeural", rate: "0.92", pitch: "-2%", gender: "male", role: "เน้นเหตุผล ถามจี้" },
            "3": { name: "คุณฤทัย", voice: "th-TH-AcharaNeural", rate: "1.05", pitch: "+2%", gender: "female", role: "ใจร้อน ยุ่งมาก" },
            "4": { name: "คุณฐิติกร", voice: "th-TH-NiwatNeural", rate: "0.85", pitch: "-8%", gender: "male", role: "ผู้บริหาร มีอำนาจ กดดัน" }
        };

        const char = charConfig[level] || charConfig["1"];
        const systemPrompt = `คุณคือ ${char.name} (${char.role}) เพศ ${char.gender === 'male' ? 'ชาย (ครับ)' : 'หญิง (ค่ะ/คะ)'} ห้ามใช้ภาษาอังกฤษ ห้ามวนคำซ้ำ ห้ามใส่ข้อความในวงเล็บ`;

        const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const gRes = await fetch(gUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: (history || []).concat([{ role: "user", parts: [{ text: message }] }]),
                system_instruction: { parts: [{ text: systemPrompt }] },
                generationConfig: { temperature: 0.8 }
            })
        });

        const gData = await gRes.json();
        const aiText = gData.candidates[0].content.parts[0].text;
        let cleanText = aiText.replace(/\(.*?\)/g, '').replace(/[*#\-_]/g, '').trim();
        if (char.gender === 'female') cleanText = cleanText.replace(/ครับ/g, 'ค่ะ');
        if (char.gender === 'male') cleanText = cleanText.replace(/ค่ะ|คะ/g, 'ครับ');

        const azRes = await fetch(`https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
            method: 'POST',
            headers: { 
                'Ocp-Apim-Subscription-Key': azureKey, 
                'Content-Type': 'application/ssml+xml', 
                'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3' 
            },
            body: `<speak version='1.0' xml:lang='th-TH'><voice xml:lang='th-TH' name='${char.voice}'><prosody rate="${char.rate}" pitch="${char.pitch}">${cleanText}</prosody></voice></speak>`
        });

        const audioBuffer = await azRes.arrayBuffer();
        res.status(200).json({ text: aiText, audio: Buffer.from(audioBuffer).toString('base64') });

    } catch (e) { res.status(500).json({ error: e.message }); }
}

