export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

    const { message, history, level, isEnding } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const azureKey = process.env.AZURE_API_KEY;
    const azureRegion = process.env.AZURE_REGION || 'southeastasia';

    try {
        // ใช้ Gemini 2.5 Flash ตามที่ตั้งค่าไว้ในระบบ
        const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        // --- 1. โหมดประเมินผล (คงเดิม) ---
        if (isEnding) {
            const evalPrompt = `คุณคือหัวหน้าเทรนเนอร์ Telesales มืออาชีพ ประเมินบทสนทนาตามเกณฑ์ 17 ข้อ ตอบเป็น JSON เท่านั้น...`;
            // ... (Logic การประเมินคงเดิม)
        }

        // --- 2. ระบบสกัดกั้นคำไม่สุภาพ (คงเดิม) ---
        const forbiddenWords = ['วะ', 'โว้ย', 'มึง', 'กู', 'ไอ้', 'ควย', 'ห่วย', 'กระจอก'];
        if (message && forbiddenWords.some(word => message.includes(word))) {
            const angryText = "ขอโทษนะคะ ถ้าพูดจาไม่สุภาพแบบนี้ ดิฉันขออนุญาตวางสายทันทีค่ะ!";
            return res.status(200).json({ text: angryText, forceDisconnect: true });
        }

        // --- 3. โหมดลูกค้าสมจริง (ปรับปรุง Character & Prompt) ---
        const charConfig = {
            "1": { name: "คุณเปรมวดี", voice: "th-TH-PremwadeeNeural", rate: "0.9", pitch: "-2%", gender: "female", role: "คนปกติที่กำลังยุ่ง ใจดีแต่มีขอบเขต", style: "พูดจาสุภาพ มีหางเสียง มีคำสร้อย เช่น 'อ๋อค่ะ', 'เอ่อ...ค่ะ'" },
            "2": { name: "คุณสมเกียรติ", voice: "th-TH-NiwatNeural", rate: "0.9", pitch: "0%", gender: "male", role: "พนักงานออฟฟิศ เน้นเหตุผล ขี้สงสัย", style: "พูดจาเป็นงานเป็นการ ชอบถามย้อน 'ไม่ทราบว่าติดต่อเรื่องอะไรนะครับ'" },
            "3": { name: "คุณฤทัย", voice: "th-TH-AcharaNeural", rate: "1.0", pitch: "+2%", gender: "female", role: "แม่บ้านใจร้อน ยุ่งอยู่กับลูก", style: "พูดเร็ว ตัดบทบ้าง 'ว่าไงคะ พอดีรีบอยู่ค่ะ'" },
            "4": { name: "คุณฐิติกร", voice: "th-TH-NiwatNeural", rate: "0.85", pitch: "-10%", gender: "male", role: "ผู้บริหารระดับสูง สุขุม มีเวลาน้อย", style: "พูดนิ่งๆ กระชับแต่สุภาพ 'ครับ ว่ามาเลยครับ มีเวลาไม่มาก'" }
        };

        const char = charConfig[level] || charConfig["1"];
        
        // จุดสำคัญ: เพิ่มตัวอย่างการตอบ (Few-shot prompting แบบนัยๆ)
        const systemPrompt = `คุณคือ ${char.name} (${char.role})
        กฎการสนทนา:
        - ตอบเป็นภาษาไทยธรรมชาติ ห้ามใช้ภาษาอังกฤษ
        - ห้ามมีวงเล็บ (..) หรือ [..] หรือสัญลักษณ์พิเศษเด็ดขาด
        - ห้ามตอบห้วน เช่น "สวัสดีค่ะเปรม" ให้พูดว่า "สวัสดีค่ะ ${char.name} พูดสายอยู่ค่ะ" หรือ "ค่ะ ${char.name} รับสายค่ะ ไม่ทราบว่าจากที่ไหนคะ"
        - ใช้คำเชื่อมประโยค (Fillers) เช่น "อ๋อ", "คือว่า", "พอดี", "อ๋อเหรอคะ" ให้เหมือนมนุษย์คุยโทรศัพท์จริง
        - ลงท้าย ${char.gender === 'male' ? 'ครับ' : 'ค่ะ/คะ'} ให้เป็นธรรมชาติ`;

        const gRes = await fetch(gUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: (history || []).concat([{ role: "user", parts: [{ text: message }] }]),
                system_instruction: { parts: [{ text: systemPrompt }] },
                generationConfig: { 
                    temperature: 0.75, // ปรับให้มีความหลากหลายแต่ไม่เพ้อเจ้อ
                    max_output_tokens: 150,
                    top_p: 0.95
                }
            })
        });

        const gData = await gRes.json();
        if (!gData.candidates) throw new Error("Gemini API Error");
        
        let aiText = gData.candidates[0].content.parts[0].text;

        // --- 🛡️ ฟังก์ชันลบสิ่งแปลกปลอม ---
        let cleanText = aiText
            .replace(/\(.*?\)/g, '')
            .replace(/\[.*?\]/g, '')
            .replace(/[*#_]/g, '')
            .replace(/\s+/g, ' ') // ลบ space ที่เกินมา
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
        res.status(200).json({ 
            text: cleanText, 
            audio: Buffer.from(audioBuffer).toString('base64') 
        });

    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: e.message }); 
    }
}
