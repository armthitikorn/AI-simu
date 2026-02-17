export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

    const { message, history, level, isEnding } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const azureKey = process.env.AZURE_API_KEY;
    const azureRegion = process.env.AZURE_REGION || 'southeastasia';

    if (!apiKey || !azureKey) {
        return res.status(500).json({ error: "API Keys are missing in environment variables" });
    }

    try {
        const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        // --- 🤖 โหมดประเมินผล (Refined Prompt & Safety) ---
        if (isEnding) {
            const evalPrompt = `คุณคือหัวหน้าเทรนเนอร์ Telesales มืออาชีพ จงประเมินบทสนทนาที่ให้มาอย่างละเอียดตามเกณฑ์ 17 ข้อ (ข้อละ 5 คะแนน คะแนนเต็ม 85)
            หัวข้อ: 1.ชื่อ-สกุล 2.เลขใบอนุญาต 3.ชื่อบริษัท 4.ขออัดเสียง 5.บทเชื่อมโยง 6.ผลประโยชน์ 7.ค่าเบี้ย 8.มูลค่ากรมธรรม์ 9.ภาษี 10.ตอบข้อโต้แย้ง 11.การสมัคร/ชำระเงิน 12.ปิดการขาย 3 ครั้ง 13.สคริปต์รวม 14.น้ำเสียง 15.การคุมสถานการณ์ 16.ไหวพริบ 17.ศักยภาพ
            กฎเหล็ก: ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอกเหนือจาก JSON
            Schema: {"score": 0-85, "strengths": "...", "weaknesses": "...", "detail_breakdown": [{"topic": "...", "stars": 0-5}]}`;

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
            if (!gData.candidates) throw new Error("Gemini Evaluation Failed");
            
            const evaluation = JSON.parse(gData.candidates[0].content.parts[0].text);
            return res.status(200).json({ evaluation });
        }

        // --- 👩‍💼 โหมดลูกค้า (Enhanced Logic) ---
        const charConfig = {
            "1": { name: "คุณเปรมวดี", voice: "th-TH-PremwadeeNeural", rate: "0.95", pitch: "0%", gender: "female", role: "ใจดี สุภาพ พร้อมฟัง" },
            "2": { name: "คุณสมเกียรติ", voice: "th-TH-NiwatNeural", rate: "1.0", pitch: "-2%", gender: "male", role: "เน้นเหตุผล ถามจี้จุด สงสัยเก่ง" },
            "3": { name: "คุณฤทัย", voice: "th-TH-AcharaNeural", rate: "1.1", pitch: "+3%", gender: "female", role: "ใจร้อน พูดเร็ว ตัดบทบ่อย" },
            "4": { name: "คุณฐิติกร", voice: "th-TH-NiwatNeural", rate: "0.85", pitch: "-10%", gender: "male", role: "ผู้บริหาร สุขุม กดดันด้วยน้ำเสียง" }
        };

        const char = charConfig[level] || charConfig["1"];
        const systemPrompt = `คุณคือ ${char.name} (${char.role}) เพศ ${char.gender}. 
        คู่สนทนาคือพนักงานขายประกัน. จงตอบโต้ให้สมจริงตามคาแรคเตอร์. 
        กฎ: 1.ห้ามใช้ภาษาอังกฤษ 2.ห้ามใช้สัญลักษณ์พิเศษ (*, #) 3.ห้ามวนประโยคซ้ำ 4.ลงท้ายด้วย ${char.gender === 'male' ? 'ครับ' : 'ค่ะ/คะ'} เสมอ`;

        const currentContents = (history || []).concat([{ role: "user", parts: [{ text: message }] }]);

        const gRes = await fetch(gUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: currentContents,
                system_instruction: { parts: [{ text: systemPrompt }] },
                generationConfig: { temperature: 0.8, max_output_tokens: 200 }
            })
        });

        const gData = await gRes.json();
        const aiText = gData.candidates[0].content.parts[0].text;
        
        // Clean text for TTS (Remove emojis and special chars)
        let cleanText = aiText.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
                              .replace(/[*#_]/g, '')
                              .trim();

        // --- 🔊 Azure TTS with Error Handling ---
        const azRes = await fetch(`https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
            method: 'POST',
            headers: { 
                'Ocp-Apim-Subscription-Key': azureKey, 
                'Content-Type': 'application/ssml+xml', 
                'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3' 
            },
            body: `<speak version='1.0' xml:lang='th-TH'><voice xml:lang='th-TH' name='${char.voice}'><prosody rate="${char.rate}" pitch="${char.pitch}">${cleanText}</prosody></voice></speak>`
        });

        if (!azRes.ok) {
            // If TTS fails, send text only
            return res.status(200).json({ text: aiText, audio: null, warning: "TTS Service Unavailable" });
        }

        const audioBuffer = await azRes.arrayBuffer();
        res.status(200).json({ 
            text: aiText, 
            audio: Buffer.from(audioBuffer).toString('base64') 
        });

    } catch (e) { 
        console.error("API Error:", e);
        res.status(500).json({ error: "Internal Server Error", details: e.message }); 
    }
}
