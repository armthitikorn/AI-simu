export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

    const { message, history, level, isEnding } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const azureKey = process.env.AZURE_API_KEY;
    const azureRegion = process.env.AZURE_REGION || 'southeastasia';

    try {
        const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        // --- 1. โหมดประเมินผล 17 ข้อ ---
        if (isEnding) {
            const evalPrompt = `คุณคือหัวหน้าเทรนเนอร์ Telesales มืออาชีพ ประเมินบทสนทนาตามเกณฑ์ 17 ข้อ (ชื่อ-สกุล, ใบอนุญาต, บริษัท, ขออัดเสียง, บทเชื่อมโยง, ผลประโยชน์, เบี้ย, มูลค่ากรมธรรม์, ภาษี, ตอบข้อโต้แย้ง, ชำระเงิน, ปิดการขาย3ครั้ง, สคริปต์รวม, น้ำเสียง, คุมสถานการณ์, ไหวพริบ, ศักยภาพ)
            ตอบเป็น JSON เท่านั้น: {"score": 0-85, "strengths": "...", "weaknesses": "...", "detail_breakdown": [{"topic": "...", "stars": 0-5}]}`;

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

        // --- 3. โหมดลูกค้าสมจริง (ลบวงเล็บ + คุมภาษา) ---
        const charConfig = {
            "1": { name: "คุณเปรมวดี", voice: "th-TH-PremwadeeNeural", rate: "0.82", pitch: "-2%", gender: "female", role: "คนปกติที่กำลังยุ่ง ไม่รู้ว่าจะโดนขายประกัน ใจดีแต่มีขอบเขต" },
            "2": { name: "คุณสมเกียรติ", voice: "th-TH-NiwatNeural", rate: "0.85", pitch: "0%", gender: "male", role: "พนักงานออฟฟิศ เน้นเหตุผล ขี้สงสัย ไม่ชอบคนพูดรัวๆ" },
            "3": { name: "คุณฤทัย", voice: "th-TH-AcharaNeural", rate: "1.0", pitch: "+2%", gender: "female", role: "แม่บ้านใจร้อน ยุ่งอยู่กับลูก ถ้าพนักงานพูดไม่รู้เรื่องจะวางสาย" },
            "4": { name: "คุณฐิติกร", voice: "th-TH-NiwatNeural", rate: "0.82", pitch: "-10%", gender: "male", role: "ผู้บริหารระดับสูง สุขุม มีเวลาให้แค่ 2 นาทีเท่านั้น" }
        };

        const char = charConfig[level] || charConfig["1"];
        const systemPrompt = `คุณคือ ${char.name} (${char.role}). 
        กฎเหล็ก:
        1. ตอบเป็นภาษาไทยเท่านั้น ห้ามใช้ภาษาอังกฤษ
        2. ห้ามเขียนคำอธิบายท่าทางในวงเล็บเด็ดขาด เช่น (ยิ้ม), (ถอนหายใจ) ห้ามใส่มา!
        3. คุณไม่รู้ว่านี่คือการขายประกัน ให้เริ่มจากความสงสัยเสมอ
        4. ลงท้ายด้วย ${char.gender === 'male' ? 'ครับ' : 'ค่ะ/คะ'} ให้สมจริงตามเพศคุณ`;

        const gRes = await fetch(gUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: (history || []).concat([{ role: "user", parts: [{ text: message }] }]),
                system_instruction: { parts: [{ text: systemPrompt }] },
                generationConfig: { temperature: 0.8, max_output_tokens: 250 }
            })
        });

        const gData = await gRes.json();
        let aiText = gData.candidates[0].content.parts[0].text;

        // --- 🛡️ ฟังก์ชันลบวงเล็บทุกรูปแบบก่อนส่งไปอ่าน ---
        let cleanText = aiText
            .replace(/\(.*?\)/g, '')  // ลบ (...)
            .replace(/\[.*?\]/g, '')  // ลบ [...]
            .replace(/[*#_]/g, '')    // ลบ Markdown
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
