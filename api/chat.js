// /api/chat.js
export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

    const { message, history, level, isEnding } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const azureKey = process.env.AZURE_API_KEY;
    const azureRegion = process.env.AZURE_REGION || 'southeastasia';

    // 1. รายการคำไม่สุภาพ (หากตรวจเจอจะวางสายทันที)
    const forbiddenWords = ['วะ', 'โว้ย', 'มึง', 'กู', 'ไอ้', 'ควย', 'ห่วย', 'อี'];

    try {
        const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        // --- โหมดประเมินผล 17 ข้อ ---
        if (isEnding) {
            const evalPrompt = `คุณคือหัวหน้าเทรนเนอร์ Telesales ประเมินบทสนทนาตามเกณฑ์ 17 ข้อ (ชื่อ-นามสกุล, ใบอนุญาต, ชื่อบริษัท, ขออัดเสียง, บทเชื่อมโยง, ผลประโยชน์, เบี้ย, มูลค่ากรมธรรม์, ภาษี, ตอบข้อโต้แย้ง, ชำระเงิน, ปิดการขาย3ครั้ง, สคริปต์รวม, น้ำเสียง, คุมสถานการณ์, ไหวพริบ, ศักยภาพ)
            ตอบเป็น JSON เท่านั้น: {"score": 0-85, "strengths": "...", "weaknesses": "...", "detail_breakdown": [{"topic": "ชื่อ-สกุล", "stars": 0-5}, ...ครบ 17 ข้อ]}`;

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
            return res.status(200).json({ evaluation: JSON.parse(gData.candidates[0].content.parts[0].text) });
        }

        // --- เช็คคำไม่สุภาพ ---
        if (message && forbiddenWords.some(word => message.includes(word))) {
            const angryText = "ขอโทษนะจ๊ะ ถ้าพูดจาไม่สุภาพแบบนี้ ไม่คุยด้วยแล้วค่ะ วางสายนะคะ!";
            return res.status(200).json({ text: angryText, forceDisconnect: true });
        }

        // --- โหมดลูกค้า (Natural Logic) ---
        const charConfig = {
            "1": { name: "คุณเปรมวดี", voice: "th-TH-PremwadeeNeural", rate: "0.82", pitch: "-2%", gender: "female", role: "คนปกติ ใจดี สุภาพ แต่ไม่รู้ว่าจะถูกขายประกัน จะเริ่มจากความสงสัย" },
            "2": { name: "คุณสมเกียรติ", voice: "th-TH-NiwatNeural", rate: "0.85", pitch: "0%", gender: "male", role: "พนักงานออฟฟิศ เน้นเหตุผล ถามเยอะ ไม่ชอบโดนยัดเยียด" },
            "3": { name: "คุณฤทัย", voice: "th-TH-AcharaNeural", rate: "1.0", pitch: "+2%", gender: "female", role: "แม่บ้านยุ่งๆ ใจร้อน รำคาญง่าย ถ้าพูดไม่เข้าหูจะวางสาย" },
            "4": { name: "คุณฐิติกร", voice: "th-TH-NiwatNeural", rate: "0.82", pitch: "-8%", gender: "male", role: "ผู้บริหาร สุขุม กดดัน มีเวลาจำกัด" }
        };

        const char = charConfig[level] || charConfig["1"];
        const systemPrompt = `คุณคือ ${char.name} (${char.role}). 
        กฎ: 1.ห้ามใช้ภาษาอังกฤษ 2.ห้ามยอมซื้อทันที ต้องมีการถามกลับ 3.ถ้าพนักงานพูดสุภาพมากให้ใจอ่อนฟังต่อ 4.ตอบสั้นๆ เหมือนคุยโทรศัพท์จริง 5.ลงท้ายด้วย ${char.gender === 'male' ? 'ครับ' : 'ค่ะ/คะ'}`;

        const gRes = await fetch(gUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: (history || []).concat([{ role: "user", parts: [{ text: message }] }]),
                system_instruction: { parts: [{ text: systemPrompt }] },
                generationConfig: { temperature: 0.7, max_output_tokens: 150 }
            })
        });

        const gData = await gRes.json();
        const aiText = gData.candidates[0].content.parts[0].text.replace(/[*#_]/g, '').trim();

        // --- Azure TTS ---
        const azRes = await fetch(`https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
            method: 'POST',
            headers: { 'Ocp-Apim-Subscription-Key': azureKey, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3' },
            body: `<speak version='1.0' xml:lang='th-TH'><voice xml:lang='th-TH' name='${char.voice}'><prosody rate="${char.rate}" pitch="${char.pitch}">${aiText}</prosody></voice></speak>`
        });

        const audioBuffer = await azRes.arrayBuffer();
        res.status(200).json({ text: aiText, audio: Buffer.from(audioBuffer).toString('base64') });

    } catch (e) { res.status(500).json({ error: e.message }); }
}
