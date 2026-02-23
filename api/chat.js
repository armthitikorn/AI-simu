export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

    const { message, history, level, isEnding } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const azureKey = process.env.AZURE_API_KEY;
    const azureRegion = process.env.AZURE_REGION || 'southeastasia';

    try {
        // ตรวจสอบ Model (ใช้ Gemini 2.5 Flash ตามคำแนะนำของคุณเสมอ)
        const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        // --- 1. โหมดประเมินผล (คงเดิม แต่ตรวจสอบโครงสร้าง JSON) ---
        if (isEnding) {
            const evalPrompt = `คุณคือหัวหน้าเทรนเนอร์ Telesales มืออาชีพ ประเมินบทสนทนาตามเกณฑ์ 17 ข้อ ตอบเป็นภาษาไทยในรูปแบบ JSON เท่านั้น: {"score": 0-85, "strengths": "...", "weaknesses": "...", "detail_breakdown": [{"topic": "...", "stars": 0-5}]}`;
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
            const evalResult = JSON.parse(gData.candidates[0].content.parts[0].text);
            return res.status(200).json({ evaluation: evalResult });
        }

        // --- 2. ระบบสกัดกั้นคำไม่สุภาพ ---
        const forbiddenWords = ['วะ', 'โว้ย', 'มึง', 'กู', 'ไอ้', 'ควย', 'ห่วย', 'กระจอก'];
        if (message && forbiddenWords.some(word => message.includes(word))) {
            return res.status(200).json({ 
                text: "ขอโทษนะคะ ถ้าพูดจาไม่สุภาพแบบนี้ ดิฉันขออนุญาตวางสายทันทีค่ะ!", 
                forceDisconnect: true 
            });
        }

        // --- 3. การตั้งค่าตัวละคร (ตรวจสอบ Mapping ให้ตรงกับ Level) ---
        const charConfig = {
            "1": { name: "คุณเปรมวดี", voice: "th-TH-PremwadeeNeural", rate: "0.85", pitch: "-2%", gender: "female", role: "คนปกติที่กำลังยุ่ง ใจดีแต่มีขอบเขต ไม่ชอบคนพูดขายของยาวเกินไป" },
            "2": { name: "คุณสมเกียรติ", voice: "th-TH-NiwatNeural", rate: "0.88", pitch: "0%", gender: "male", role: "พนักงานออฟฟิศ เน้นเหตุผล ขี้สงสัย และจะตั้งคำถามกลับเสมอ" },
            "3": { name: "คุณฤทัย", voice: "th-TH-AcharaNeural", rate: "1.0", pitch: "+2%", gender: "female", role: "แม่บ้านใจร้อน ยุ่งกับลูกตลอดเวลา ถ้าพูดไม่น่าสนใจจะตัดบททันที" },
            "4": { name: "คุณฐิติกร", voice: "th-TH-NiwatNeural", rate: "0.85", pitch: "-10%", gender: "male", role: "ผู้บริหารระดับสูง สุขุม พูดน้อยแต่ชัดเจน มีเวลาจำกัดมาก" }
        };

        const char = charConfig[level] || charConfig["1"];

        // ✨ ปรับปรุง System Prompt: เน้นความเป็นธรรมชาติและลดความห้วน
        const systemPrompt = `คุณคือ ${char.name} บทบาทคือ ${char.role}
        ** กฎสำคัญในการสนทนา **
        1. ตอบเป็นภาษาไทยระดับกันเอง (Natural Thai) ห้ามใช้ภาษาอังกฤษเด็ดขาด
        2. ห้ามใช้คำอธิบายท่าทางในวงเล็บ (เช่น ยิ้ม, ถอนหายใจ) ห้ามเขียนส่งมาใน Text
        3. **ห้ามตอบสั้นแค่คำเดียว**: เช่น ถ้าจะตอบว่า 'ค่ะ' ให้เปลี่ยนเป็น 'ค่ะ ว่าไงคะ?' หรือ 'ค่ะ ติดธุระอยู่นิดหน่อย มีอะไรหรือเปล่าคะ?'
        4. **การจบประโยค**: ต้องพูดให้จบใจความและลงท้ายด้วย ${char.gender === 'male' ? 'ครับ' : 'ค่ะ/คะ'} ให้เหมาะสมกับสถานการณ์
        5. คุณไม่รู้ว่านี่คือพนักงานขายประกันในช่วงแรก ให้แสดงอาการเหมือนคนรับสายเบอร์แปลกทั่วไป (มีความระแวงเล็กน้อย)`;

        const gRes = await fetch(gUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: (history || []).concat([{ role: "user", parts: [{ text: message }] }]),
                system_instruction: { parts: [{ text: systemPrompt }] },
                generationConfig: { 
                    temperature: 0.75, // ปรับให้มีความหลากหลายของคำพูด แต่ยังอยู่ในกรอบ
                    max_output_tokens: 350, 
                    top_p: 0.95
                }
            })
        });

        const gData = await gRes.json();
        let aiText = gData.candidates[0].content.parts[0].text;

        // --- 🛡️ Clean Text เพื่อความเสถียรของ TTS ---
        let cleanText = aiText
            .replace(/\(.*?\)/g, '')
            .replace(/\[.*?\]/g, '')
            .replace(/[*#_~]/g, '')
            .replace(/\s+/g, ' ') // ลบช่องว่างที่ซ้ำซ้อน
            .trim();

        // --- 🔊 Azure TTS ---
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
        
        // ✨ ส่งข้อมูลกลับ (รวมข้อมูลตัวละครเพื่อให้หน้าจอ Update)
        res.status(200).json({ 
            text: cleanText, 
            audio: Buffer.from(audioBuffer).toString('base64'),
            character: {
                name: char.name,
                level: level
            }
        });

    } catch (e) { 
        console.error("API Error:", e);
        res.status(500).json({ error: "เกิดข้อผิดพลาดในการประมวลผล กรุณาลองใหม่อีกครั้ง" }); 
    }
                  }
