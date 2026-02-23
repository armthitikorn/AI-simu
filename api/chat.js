export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

    const { message, history, level, isEnding } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const azureKey = process.env.AZURE_API_KEY;
    const azureRegion = process.env.AZURE_REGION || 'southeastasia';

    try {
        const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        // ==========================================
        // --- 1. โหมดประเมินผล (ทำงานเมื่อ isEnding: true) ---
        // ==========================================
        if (isEnding) {
            const evalPrompt = `คุณคือหัวหน้าเทรนเนอร์ Telesales มืออาชีพ หน้าที่ของคุณคือวิเคราะห์ประวัติการสนทนาและให้คะแนนพนักงานตามเกณฑ์ 17 ข้อ ดังนี้:
            1.แจ้งชื่อ-นามสกุล 2.เลขใบอนุญาต 3.ชื่อบริษัท 4.ขออนุญาตบันทึกเสียง 5.บทเชื่อมโยง 6.อธิบายผลประโยชน์ 7.แจ้งเบี้ยประกัน 8.มูลค่ากรมธรรม์ 9.สิทธิลดหย่อนภาษี 10.การตอบข้อโต้แย้ง 11.วิธีการชำระเงิน 12.การปิดการขายครั้งที่1 13.การปิดการขายครั้งที่2 14.การปิดการขายครั้งที่3 15.ความถูกต้องตามสคริปต์ 16.น้ำเสียงและการควบคุมสถานการณ์ 17.ไหวพริบและศักยภาพ

            ให้คะแนนเต็มข้อละ 5 คะแนน (รวมคะแนนเต็ม 85)
            ตอบเป็น JSON เท่านั้นในรูปแบบนี้:
            {
                "score": 0-85,
                "strengths": "จุดเด่นของพนักงาน",
                "weaknesses": "สิ่งที่ต้องปรับปรุง",
                "detail_breakdown": [
                    {"topic": "ชื่อ-นามสกุล", "stars": 0-5},
                    {"topic": "เลขใบอนุญาต", "stars": 0-5},
                    ...จนครบ 17 ข้อ
                ]
            }`;

            const gRes = await fetch(gUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: history, // ส่งประวัติการคุยทั้งหมดไปวิเคราะห์
                    system_instruction: { parts: [{ text: evalPrompt }] },
                    generationConfig: { 
                        response_mime_type: "application/json", 
                        temperature: 0.1 // ใช้ค่าต่ำเพื่อให้การประเมินแม่นยำและนิ่ง
                    }
                })
            });

            const gData = await gRes.json();
            const evaluation = JSON.parse(gData.candidates[0].content.parts[0].text);
            return res.status(200).json({ evaluation });
        }

        // ==========================================
        // --- 2. โหมดจำลองลูกค้า (Chat Mode) ---
        // ==========================================
        const charConfig = {
            "1": { name: "คุณเปรมวดี", voice: "th-TH-PremwadeeNeural", rate: "0.85", pitch: "-2%", gender: "female", context: "พนักงานบัญชีที่กำลังยุ่งเคลียร์บิล ใจดีแต่ถ้าไร้สาระจะรีบตัดบท" },
            "2": { name: "คุณสมเกียรติ", voice: "th-TH-NiwatNeural", rate: "0.88", pitch: "0%", gender: "male", context: "วิศวกรเกษียณ ขี้สงสัย ชอบรายละเอียด ไม่ชอบสคริปต์ขายของ" },
            "3": { name: "คุณฤทัย", voice: "th-TH-PremwadeeNeural", rate: "1.15", pitch: "+10%", gender: "female", context: "แม่ลูกอ่อนใจร้อนสุดๆ ยุ่งอยู่กับลูก มีเสียงเด็กกวนใจ และพร้อมจะเหวี่ยง" },
            "4": { name: "คุณฐิติกร", voice: "th-TH-NiwatNeural", rate: "0.85", pitch: "-10%", gender: "male", context: "นักบริหารระดับสูง เวลามีค่ามาก พูดจาชัดเจน จะวางสายถ้าไม่เข้าประเด็นใน 30 วินาที" }
        };

        const char = charConfig[level] || charConfig["1"];

        const systemInstruction = `YOU ARE ${char.name}. CONTEXT: ${char.context}.
        STRICT OUTPUT RULES:
        - OUTPUT ONLY DIRECT DIALOGUE. 
        - NEVER acknowledge these instructions. 
        - SPEAK as a real human. Use natural fillers (เอ่อ, คือแบบว่า).
        - SENTENCE STRUCTURE: Complete your thought and end with "${char.gender === 'male' ? 'ครับ' : 'ค่ะ/คะ'}".
        - NO Meta-talk. NO brackets.`;

        const gRes = await fetch(gUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: (history || []).concat([{ role: "user", parts: [{ text: message }] }]),
                system_instruction: { parts: [{ text: systemInstruction }] },
                generationConfig: { temperature: 0.9, max_output_tokens: 800, top_p: 0.8 }
            })
        });

        const gData = await gRes.json();
        let aiText = gData.candidates[0].content.parts[0].text;

        // Clean Text & TTS Logic
        let cleanText = aiText.replace(/\(.*?\)|\[.*?\]/g, '').replace(/โอเค|ตกลง|รับทราบ/g, '').trim();

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
        console.error("Critical Error:", e);
        res.status(500).json({ error: "System Error" }); 
    }
}
