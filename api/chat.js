export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

    const { message, history, level, isEnding } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const azureKey = process.env.AZURE_API_KEY;
    const azureRegion = process.env.AZURE_REGION || 'southeastasia';

    try {
        const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        // --- 1. โหมดประเมินผล (คงเดิม) ---
        if (isEnding) { /* ... โค้ดประเมินผล 17 ข้อ ... */ }

        // --- 2. การตั้งค่าตัวละคร ---
        const charConfig = {
            "1": { name: "คุณเปรมวดี", voice: "th-TH-PremwadeeNeural", rate: "0.85", pitch: "-2%", gender: "female", role: "คนปกติที่กำลังยุ่ง ใจดีแต่มีขอบเขต" },
            "2": { name: "คุณสมเกียรติ", voice: "th-TH-NiwatNeural", rate: "0.88", pitch: "0%", gender: "male", role: "พนักงานออฟฟิศ เน้นเหตุผล ขี้สงสัย" },
            "3": { name: "คุณฤทัย", voice: "th-TH-AcharaNeural", rate: "1.0", pitch: "+2%", gender: "female", role: "แม่บ้านใจร้อน ยุ่งอยู่กับลูก" },
            "4": { name: "คุณฐิติกร", voice: "th-TH-NiwatNeural", rate: "0.85", pitch: "-10%", gender: "male", role: "ผู้บริหารระดับสูง สุขุม มีเวลาจำกัด" }
        };

        const char = charConfig[level] || charConfig["1"];

        // ✨ ปรับ Prompt เน้น "ความสมบูรณ์ของประโยค"
        const systemPrompt = `คุณคือ ${char.name} (${char.role})
        ** กฎเหล็กที่ต้องทำตามอย่างเคร่งครัด **
        1. ตอบเป็นภาษาไทยธรรมชาติ ห้ามมีภาษาอังกฤษ
        2. ห้ามใช้คำอธิบายในวงเล็บเด็ดขาด
        3. **ต้องพูดให้จบประโยคและใจความสมบูรณ์**: ห้ามหยุดพูดกลางคัน หรือค้างประโยคไว้
        4. **ความยาวและการตอบโต้**: ให้ตอบเหมือนคนคุยโทรศัพท์จริงๆ (ประมาณ 2-4 ประโยค) โดยต้องมีการลงท้ายด้วย ${char.gender === 'male' ? 'ครับ' : 'ค่ะ/คะ'} ให้เรียบร้อยก่อนจบคำตอบเสมอ
        5. หากคุณเริ่มรู้สึกรำคาญหรืออยากวางสาย ให้บอกเหตุผลให้จบ เช่น "แค่นี้ก่อนนะคะ พอดีติดธุระจริงๆ ค่ะ" ห้ามตัดบทไปเฉยๆ`;

        const gRes = await fetch(gUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: (history || []).concat([{ role: "user", parts: [{ text: message }] }]),
                system_instruction: { parts: [{ text: systemPrompt }] },
                generationConfig: { 
                    temperature: 0.8, 
                    max_output_tokens: 500, // ✨ เพิ่มตามที่คุณต้องการ เพื่อให้จบประโยคได้สวยๆ
                    top_p: 0.95,
                    candidate_count: 1
                }
            })
        });

        const gData = await gRes.json();
        
        if (!gData.candidates || !gData.candidates[0].content.parts[0].text) {
            throw new Error("AI ไม่ส่งข้อมูลกลับมา");
        }

        let aiText = gData.candidates[0].content.parts[0].text;

        // --- 🛡️ Clean Text ---
        let cleanText = aiText
            .replace(/\(.*?\)/g, '')
            .replace(/\[.*?\]/g, '')
            .replace(/[*#_~]/g, '')
            .replace(/\s+/g, ' ')
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
            audio: Buffer.from(audioBuffer).toString('base64'),
            character: { name: char.name }
        });

    } catch (e) { 
        console.error("API Error:", e);
        res.status(500).json({ error: "ระบบขัดข้อง กรุณาลองใหม่ครับ" }); 
    }
}
