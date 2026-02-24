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
            const evalPrompt = `คุณคือหัวหน้าเทรนเนอร์ Telesales มืออาชีพ วิเคราะห์ประวัติการสนทนาและให้คะแนนพนักงานตามเกณฑ์ 17 ข้อ ตอบเป็น JSON เท่านั้น: {"score": 0-85, "strengths": "...", "weaknesses": "...", "detail_breakdown": [{"topic": "...", "stars": 0-5}]}`;

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

        // ==========================================
        // --- 2. โหมดจำลองลูกค้า (Chat Mode) ---
        // ==========================================
        
        // ฐานข้อมูลลูกค้า (เพิ่มข้อมูลสำหรับการลงทะเบียน)
        const charConfig = {
            "1": { 
                name: "คุณเปรมวดี", 
                voice: "th-TH-PremwadeeNeural", 
                rate: "0.85", pitch: "-2%", gender: "female", 
                context: "พนักงานบัญชีที่กำลังยุ่งเคลียร์บิล ใจดีแต่ถ้าไร้สาระจะรีบตัดบท",
                regInfo: "ที่อยู่: 123/45 ซอยอารีย์ พหลโยธิน กรุงเทพฯ 10400 | บัตร Visa กสิกรไทย: 4546 0987 1234 5678 หมดอายุ 05/29 | ผู้รับประโยชน์: นายมานะ สุขใจ (สามี)"
            },
            "2": { 
                name: "คุณสมเกียรติ", 
                voice: "th-TH-NiwatNeural", 
                rate: "0.88", pitch: "0%", gender: "male", 
                context: "วิศวกรเกษียณ ขี้สงสัย ชอบรายละเอียด ไม่ชอบสคริปต์ขายของ",
                regInfo: "ที่อยู่: 9/99 คอนโดวิภาวดีรังสิต จตุจักร กรุงเทพฯ 10900 | บัตร Mastercard SCB: 5412 0000 1111 2222 หมดอายุ 10/28 | ผู้รับประโยชน์: นางสมศรี มั่นคง (ภรรยา)"
            },
            "3": { 
                name: "คุณฤทัย", 
                voice: "th-TH-PremwadeeNeural", 
                rate: "1.15", pitch: "+10%", gender: "female", 
                context: "แม่ลูกอ่อนใจร้อนสุดๆ ยุ่งอยู่กับลูก มีเสียงเด็กกวนใจ และพร้อมจะเหวี่ยง",
                regInfo: "ที่อยู่: 55 หมู่ 4 ต.บางกรวย อ.บางกรวย นนทบุรี 11130 | บัตร KTC: 4321 5555 6666 7777 หมดอายุ 12/27 | ผู้รับประโยชน์: เด็กชายก้องภพ (ลูกชาย)"
            },
            "4": { 
                name: "คุณฐิติกร", 
                voice: "th-TH-NiwatNeural", 
                rate: "0.85", pitch: "-10%", gender: "male", 
                context: "นักบริหารระดับสูง เวลามีค่ามาก จะวางสายถ้าไม่เข้าประเด็นใน 30 วินาที",
                regInfo: "ที่อยู่: อาคารออฟฟิศย่านสุขุมวิท 21 วัฒนา กรุงเทพฯ 10110 | บัตร Visa Infinite: 4111 2222 3333 4444 หมดอายุ 01/30 | ผู้รับประโยชน์: กองทุนการกุศล"
            }
        };

        const char = charConfig[level] || charConfig["1"];

        const systemInstruction = `YOU ARE ${char.name}. CONTEXT: ${char.context}.
        
        YOUR REGISTRATION DATA (Use this ONLY when the agent closes the sale properly):
        ${char.regInfo}

        STRICT OUTPUT RULES:
        - OUTPUT ONLY DIRECT DIALOGUE.
        - SPEAK as a real human. Use natural fillers (เอ่อ, คือแบบว่า).
        - หากพนักงานขอเลขบัตรเครดิต: ในครั้งแรกให้ถามถึงความปลอดภัยก่อนเสมอ (เช่น "จะปลอดภัยไหมคะ?") ถ้าพนักงานอธิบายได้ดีค่อยบอกเลข 16 หลักทีละ 4 ตัว
        - SENTENCE STRUCTURE: Always end with "${char.gender === 'male' ? 'ครับ' : 'ค่ะ/คะ'}".
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
