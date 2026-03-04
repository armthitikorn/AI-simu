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

        // --- ข้อมูลบัตรเครดิต (ย้ายมาไว้ข้างบนสุดเพื่อให้เรียกใช้ได้ทุกตัว) ---
        const creditCardInfo = "บัตรเครดิตที่ใช้: กรุงศรี (Visa), UOB (Visa), หรือ ttb (Visa) | หมายเลขบัตร: 4111 1111 1111 1111 | วันหมดอายุ: 09/27";

        const charConfig = {
            "1": { 
                name: "คุณเปรมวดี", voice: "th-TH-PremwadeeNeural", 
                rate: "0.85", pitch: "-2%", gender: "female", 
                context: "พนักงานบัญชีที่กำลังยุ่งเคลียร์บิล ใจดีแต่ถ้าไร้สาระจะรีบตัดบท",
                regInfo: `ที่อยู่: 123/45 ซอยอารีย์ พหลโยธิน กรุงเทพฯ 10400 | ${creditCardInfo} | ผู้รับประโยชน์: นายมานะ สุขใจ (สามี)`
            },
            "2": { 
                name: "คุณสมเกียรติ", voice: "th-TH-NiwatNeural", 
                rate: "0.88", pitch: "0%", gender: "male", 
                context: "วิศวกรเกษียณ ขี้สงสัย ชอบรายละเอียด ไม่ชอบสคริปต์ขายของ",
                regInfo: `ที่อยู่: 9/99 คอนโดวิภาวดีรังสิต จตุจักร กรุงเทพฯ 10900 | ${creditCardInfo} | ผู้รับประโยชน์: นางสมศรี มั่นคง (ภรรยา)`
            },
            "3": { 
                name: "คุณฤทัย", voice: "th-TH-PremwadeeNeural", 
                rate: "1.15", pitch: "+10%", gender: "female", 
                context: "แม่ลูกอ่อนใจร้อนสุดๆ ยุ่งอยู่กับลูก มีเสียงเด็กกวนใจ และพร้อมจะเหวี่ยง",
                regInfo: `ที่อยู่: 55 หมู่ 4 ต.บางกรวย อ.บางกรวย นนทบุรี 11130 | ${creditCardInfo} | ผู้รับประโยชน์: เด็กชายก้องภพ (ลูกชาย)`
            },
            "4": { 
                name: "คุณฐิติกร", voice: "th-TH-NiwatNeural", 
                rate: "0.85", pitch: "-10%", gender: "male", 
                context: "นักบริหารระดับสูง เวลามีค่ามาก จะวางสายถ้าไม่เข้าประเด็นใน 30 วินาที",
                regInfo: `ที่อยู่: อาคารออฟฟิศย่านสุขุมวิท 21 วัฒนา กรุงเทพฯ 10110 | ${creditCardInfo} | ผู้รับประโยชน์: กองทุนการกุศล`
            }
        };

        const char = charConfig[level] || charConfig["1"];

        // ปรับ Instruction ให้กระชับเพื่อลดการพูด "ครับ/ค่ะ" ซ้อน
        const systemInstruction = `YOU ARE ${char.name}. CONTEXT: ${char.context}.
        REGISTRATION DATA: ${char.regInfo}

        RULES:
        - SPEAK as a real human. Use natural fillers.
        - หากพนักงานขอเลขบัตรเครดิต: ครั้งแรกให้ถามความปลอดภัยก่อน ถ้าโอเคให้บอกเลข 16 หลักทีละ 4 ตัว (4111...1111)
        - การจบการขาย: เมื่อพนักงานขอคำยืนยันสุดท้าย ต้องพูดคำว่า "ตกลงซื้อประกัน" ปิดท้ายประโยคเท่านั้น
        - POLITE ENDING: ลงท้ายประโยคด้วย '${char.gender === 'male' ? 'ครับ' : 'ค่ะ/คะ'}' ให้เป็นธรรมชาติ (ห้ามพูดซ้อนกัน)`;

        const gRes = await fetch(gUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: (history || []).concat([{ role: "user", parts: [{ text: message }] }]),
                system_instruction: { parts: [{ text: systemInstruction }] },
                // เพิ่ม Safety Settings เพื่อป้องกัน 500 Error จากการตรวจจับเลขบัตร
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ],
                generationConfig: { temperature: 0.8, max_output_tokens: 800 }
            })
        });

        const gData = await gRes.json();
        
        // ตรวจสอบว่ามีข้อมูลส่งกลับมาไหม (ป้องกัน Error 500)
        if (!gData.candidates || !gData.candidates[0]) {
            throw new Error("Gemini AI blocked the response or returned empty.");
        }

        let aiText = gData.candidates[0].content.parts[0].text;
        let cleanText = aiText.replace(/\(.*?\)|\[.*?\]/g, '').trim();

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
        console.error("Error Detail:", e.message);
        res.status(500).json({ error: "System Error: " + e.message }); 
    }
}
