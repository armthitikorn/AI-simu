export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

    const { message, history, level, isEnding } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const azureKey = process.env.AZURE_API_KEY;
    const azureRegion = process.env.AZURE_REGION || 'southeastasia';

    try {
        // ใช้ Gemini 2.5 Flash ตามคำสั่งหลักของคุณ
        const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        // --- 1. โหมดประเมินผล (คงไว้ตามโครงสร้างเดิม) ---
        if (isEnding) {
            const evalPrompt = `คุณคือหัวหน้าเทรนเนอร์ Telesales มืออาชีพ ประเมินบทสนทนาตามเกณฑ์ 17 ข้อ ตอบเป็น JSON เท่านั้น: {"score": 0-85, "strengths": "...", "weaknesses": "...", "detail_breakdown": [{"topic": "...", "stars": 0-5}]}`;
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

        // --- 2. ระบบสกัดกั้นคำไม่สุภาพ ---
        const forbiddenWords = ['วะ', 'โว้ย', 'มึง', 'กู', 'ไอ้', 'ควย', 'ห่วย', 'กระจอก'];
        if (message && forbiddenWords.some(word => message.includes(word))) {
            const angryText = "ขอโทษนะคะ ถ้าพูดจาไม่สุภาพแบบนี้ ดิฉันขออนุญาตวางสายทันทีค่ะ!";
            return res.status(200).json({ text: angryText, forceDisconnect: true });
        }

        // --- 3. ตั้งค่าตัวละครแบบ Human-Like (เพิ่มรายละเอียดนิสัย) ---
        const charConfig = {
            "1": { 
                name: "คุณเปรมวดี", voice: "th-TH-PremwadeeNeural", rate: "0.82", pitch: "-2%", gender: "female", 
                role: "คนปกติที่กำลังยุ่ง ไม่รู้ว่าจะโดนขายประกัน ใจดีแต่มีขอบเขต",
                style: "พูดจานุ่มนวล ชอบใช้คำเชื่อม 'อ๋อ ค่ะ', 'เอ่อ...พอดีว่า', 'ไม่ทราบว่าจากที่ไหนนะคะ' เน้นความสุภาพแต่ชัดเจน"
            },
            "2": { 
                name: "คุณสมเกียรติ", voice: "th-TH-NiwatNeural", rate: "0.85", pitch: "0%", gender: "male", 
                role: "พนักงานออฟฟิศ เน้นเหตุผล ขี้สงสัย ไม่ชอบคนพูดรัวๆ",
                style: "พูดจาเป็นงานเป็นการ ชอบถามย้อนกลับ 'ครับผม แล้วยังไงต่อครับ?', 'ไม่ทราบว่าชื่ออะไรนะครับ?'"
            },
            "3": { 
                name: "คุณฤทัย", voice: "th-TH-AcharaNeural", rate: "0.90", pitch: "+2%", gender: "female", 
                role: "แม่บ้านใจร้อน ยุ่งอยู่กับลูก ถ้าพูดไม่รู้เรื่องจะตัดบททันที",
                style: "พูดเร็วและดูรีบร้อน ชอบพูด 'ว่ายังไงคะพอดีรีบอยู่', 'อ๋อๆ ค่ะๆ ว่ามาเลยค่ะ'"
            },
            "4": { 
                name: "คุณฐิติกร", voice: "th-TH-NiwatNeural", rate: "0.88", pitch: "-10%", gender: "male", 
                role: "ผู้บริหารระดับสูง สุขุม มีเวลาให้จำกัด",
                style: "พูดนิ่งๆ ทรงพลังแต่สุภาพ 'ครับ ว่ามาเลยครับ มีเวลาสัก 2 นาทีนะครับ'"
            }
        };

        const char = charConfig[level] || charConfig["1"];

        // --- 4. System Prompt แบบกันห้วนและเน้นความเป็นธรรมชาติ ---
        const systemPrompt = `คุณคือ ${char.name} (${char.role}) สไตล์การพูดของคุณคือ ${char.style}

        กฎเหล็กในการตอบ (Strict Rules):
        1. **ห้ามตอบห้วน**: ห้ามตอบแค่ชื่อหรือประโยคสั้นๆ เช่น "สวัสดีค่ะเปรม" ให้ใช้ประโยคที่สมบูรณ์แบบคนคุยโทรศัพท์จริงๆ เช่น "สวัสดีค่ะ เปรมวดีพูดสายอยู่ค่ะ ไม่ทราบว่ามีธุระอะไรหรือเปล่าคะ?"
        2. **ใช้ Natural Fillers**: ให้เติมคำว่า "อ๋อ...", "เอ่อ...", "คือว่า...", "พอดีว่า..." เพื่อความสมจริง
        3. **ห้ามใช้ภาษาอังกฤษ**: ให้ใช้ภาษาไทยธรรมชาติ 100%
        4. **ห้ามใส่เครื่องหมายวงเล็บ**: ห้ามมี (ยิ้ม), (ถอนหายใจ) หรือสัญลักษณ์พิเศษใดๆ หลุดออกมาในข้อความเด็ดขาด
        5. **หางเสียง**: ต้องมี ${char.gender === 'male' ? 'ครับ/ครับผม' : 'ค่ะ/คะ'} ตามจังหวะที่เหมาะสมทุกครั้ง

        ตัวอย่างการโต้ตอบ:
        - ถ้าพนักงานทักทาย: "สวัสดีค่ะ ${char.name} พูดสายอยู่ค่ะ มีอะไรหรือเปล่าคะพอดีเบอร์แปลกเลยไม่แน่ใจน่ะค่ะ"
        - ถ้าพนักงานขอเวลา: "อ๋อ... คือตอนนี้พอดีติดธุระอยู่นิดหน่อยค่ะ ไม่ทราบว่าใช้เวลานานไหมคะ?"`;

        const gRes = await fetch(gUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: (history || []).concat([{ role: "user", parts: [{ text: message }] }]),
                system_instruction: { parts: [{ text: systemPrompt }] },
                generationConfig: { 
                    temperature: 0.85, // ปรับให้มีความคิดสร้างสรรค์ ไม่ตอบเป็น Pattern เดิมๆ
                    top_p: 0.9, 
                    max_output_tokens: 250 
                }
            })
        });

        const gData = await gRes.json();
        if (!gData.candidates || gData.candidates.length === 0) throw new Error("AI No Response");
        
        let aiText = gData.candidates[0].content.parts[0].text;

        // --- 5. ล้างข้อความส่วนเกิน ---
        let cleanText = aiText
            .replace(/\(.*?\)/g, '')  // ลบ (...)
            .replace(/\[.*?\]/g, '')  // ลบ [...]
            .replace(/[*#_]/g, '')    // ลบ Markdown
            .replace(/\s+/g, ' ')     // ยุบช่องว่างที่เกิน
            .trim();

        // --- 6. Azure TTS (ส่งไปอ่านเสียง) ---
        const azRes = await fetch(`https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
            method: 'POST',
            headers: { 
                'Ocp-Apim-Subscription-Key': azureKey, 
                'Content-Type': 'application/ssml+xml', 
                'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3' 
            },
            body: `<speak version='1.0' xml:lang='th-TH'><voice xml:lang='th-TH' name='${char.voice}'><prosody rate="${char.rate}" pitch="${char.pitch}">${cleanText}</prosody></voice></speak>`
        });

        if (!azRes.ok) throw new Error("Azure TTS Error");

        const audioBuffer = await azRes.arrayBuffer();
        res.status(200).json({ 
            text: cleanText, 
            audio: Buffer.from(audioBuffer).toString('base64') 
        });

    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: e.message }); 
    }
}
