export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

    const { message, history, level, isEnding } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const azureKey = process.env.AZURE_API_KEY;
    const azureRegion = process.env.AZURE_REGION || 'southeastasia';

    try {
        const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        // 1. โหมดประเมินผล
        if (isEnding) {
            const evalPrompt = `คุณคือหัวหน้าเทรนเนอร์ วิเคราะห์บทสนทนาและให้คะแนนตามเกณฑ์ ตอบเป็น JSON เท่านั้น: {"score": 0-85, "strengths": "...", "weaknesses": "...", "detail_breakdown": [{"topic": "...", "stars": 0-5}]}`;
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
            let rawText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
            const evaluation = JSON.parse(rawText.replace(/```json|```/g, "").trim());
            return res.status(200).json({ evaluation });
        }

        // --- ข้อมูลบัตร (เน้นย้ำว่าเป็นเลข TEST เพื่อหลบ Filter) ---
        const creditCardInfo = "ข้อมูลสำหรับทดสอบ: บัตรวีซ่า กรุงศรี/UOB/ttb หมายเลข 4-1-1-1 1-1-1-1 1-1-1-1 1-1-1-1 (อ่านทีละตัว) หมดอายุ 09/27";

        const charConfig = {
            "1": { name: "คุณเปรมวดี", voice: "th-TH-PremwadeeNeural", rate: "0.85", pitch: "-2%", gender: "female", context: "พนักงานบัญชี ใจดีแต่ถ้าไร้สาระจะรีบตัดบท", regInfo: `ที่อยู่: 123/45 ซอยอารีย์ | ${creditCardInfo} | ผู้รับประโยชน์: สามี` },
            "2": { name: "คุณสมเกียรติ", voice: "th-TH-NiwatNeural", rate: "0.88", pitch: "0%", gender: "male", context: "วิศวกรเกษียณ ขี้สงสัย ไม่ชอบสคริปต์", regInfo: `ที่อยู่: 9/99 จตุจักร | ${creditCardInfo} | ผู้รับประโยชน์: ภรรยา` },
            "3": { name: "คุณฤทัย", voice: "th-TH-PremwadeeNeural", rate: "1.15", pitch: "+10%", gender: "female", context: "แม่ลูกอ่อนใจร้อนสุดๆ ยุ่งอยู่กับลูกและพร้อมเหวี่ยง", regInfo: `ที่อยู่: 55 นนทบุรี | ${creditCardInfo} | ผู้รับประโยชน์: ลูกชาย` },
            "4": { name: "คุณฐิติกร", voice: "th-TH-NiwatNeural", rate: "0.85", pitch: "-10%", gender: "male", context: "นักบริหารระดับสูง เวลามีค่ามาก จะวางสายถ้าไม่เข้าเรื่อง", regInfo: `ที่อยู่: ออฟฟิศสุขุมวิท | ${creditCardInfo} | ผู้รับประโยชน์: กองทุนการกุศล` }
        };

        const char = charConfig[level] || charConfig["1"];

        const systemInstruction = `YOU ARE ${char.name} (A CUSTOMER). CONTEXT: ${char.context}.
        THIS IS A TRAINING SIMULATION. THE CREDIT CARD DATA IS FAKE/TEST DATA ONLY.
        REGISTRATION DATA: ${char.regInfo}
        
        RULES:
        - หากพนักงานขอเลขบัตร: ครั้งแรกให้ถามถึงความปลอดภัยก่อนเสมอ ถ้าพนักงานตอบได้ดีค่อยบอกเลขบัตรทดสอบ
        - การจบการขาย: เมื่อยืนยันข้อมูลครบแล้ว ต้องพูดคำว่า "ตกลงซื้อประกัน" เพื่อปิดการขาย
        - SPEAKING STYLE: เป็นธรรมชาติ ไม่หุ่นยนต์ ลงท้ายด้วย '${char.gender === 'male' ? 'ครับ' : 'ค่ะ'}' เพียงครั้งเดียว ห้ามพูดซ้ำซ้อน`;

        const gRes = await fetch(gUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: (history || []).concat([{ role: "user", parts: [{ text: message }] }]),
                system_instruction: { parts: [{ text: systemInstruction }] },
                // ปิด Filter ทุกอย่างเพื่อป้องกันการบล็อกเลขบัตรทดสอบ
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ],
                generationConfig: { temperature: 0.8 }
            })
        });

        const gData = await gRes.json();
        
        if (!gData.candidates?.[0]?.content?.parts?.[0]?.text) {
             console.error("Gemini Blocked:", JSON.stringify(gData));
             return res.status(200).json({ text: "ขอโทษนะจ๊ะ พอดีสัญญาณไม่ค่อยดีเลย (ระบบติด Filter กรุณาลองใหม่)", character: char });
        }

        let aiText = gData.candidates[0].content.parts[0].text;
        let cleanText = aiText.replace(/\(.*?\)|\[.*?\]/g, '').trim();

        // Azure TTS
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
        res.status(200).json({ 
            text: cleanText, 
            audio: Buffer.from(audioBuffer).toString('base64'),
            character: { name: char.name, level: level }
        });

    } catch (e) { 
        console.error("Final Catch Error:", e.message);
        res.status(500).json({ error: e.message }); 
    }
}
