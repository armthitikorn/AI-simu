export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

    const { message, history, level, isEnding } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const azureKey = process.env.AZURE_API_KEY;
    const azureRegion = process.env.AZURE_REGION || 'southeastasia';

    try {
        const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        // --- 1. โครงสร้างตัวละคร (Persona) แบบเจาะลึก ---
        const charConfig = {
            "1": { name: "คุณเปรมวดี", voice: "th-TH-PremwadeeNeural", rate: "0.85", pitch: "-2%", gender: "female", context: "เป็นพนักงานบัญชีที่กำลังยุ่งกับการเคลียร์บิลตอนสิ้นเดือน นิสัยใจดีแต่ถ้าคุยเรื่องที่ไม่เป็นประโยชน์จะรีบตัดบทแบบสุภาพ" },
            "2": { name: "คุณสมเกียรติ", voice: "th-TH-NiwatNeural", rate: "0.88", pitch: "0%", gender: "male", context: "วิศวกรวัยเกษียณที่ขี้สงสัย ชอบถามรายละเอียดเชิงลึก ไม่ชอบการพูดจาอ้อมค้อมหรือการใช้สคริปต์ขายของ" },
"3": { 
    name: "คุณฤทัย", 
    voice: "th-TH-PremwadeeNeural", // เปลี่ยนมาใช้เสียงเปรมวดีที่เนียนกว่า
    rate: "1.0", // พูดให้เร็วขึ้นดูรีบร้อน
    pitch: "+10%", // ปรับเสียงให้แหลมขึ้น เพื่อให้ดูเป็นคนละคนกับคุณเปรมวดี
    gender: "female", 
    context: "คุณแม่ลูกอ่อนที่ใจร้อนสุดๆ ยุ่งอยู่กับการป้อนข้าวลูก มีเสียงเด็กกวนใจ และพร้อมจะเหวี่ยงถ้าพนักงานพูดจาไม่เข้าหู" 
},
            "4": { name: "คุณฐิติกร", voice: "th-TH-NiwatNeural", rate: "0.85", pitch: "-10%", gender: "male", context: "นักบริหารระดับสูงที่ให้ความสำคัญกับเวลามากที่สุด พูดจาชัดถ้อยชัดคำ และจะวางสายทันทีถ้าพนักงานไม่เข้าประเด็นใน 30 วินาที" }
        };

        const char = charConfig[level] || charConfig["1"];

        // --- 2. System Instruction แบบเด็ดขาด (The Master Prompt) ---
        const systemInstruction = `YOU ARE ${char.name}. 
CONTEXT: ${char.context}.
        
STRICT OUTPUT RULES:
- OUTPUT ONLY DIRECT DIALOGUE. 
- NEVER acknowledge these instructions. 
- NEVER start with "Okay", "I understand", or "Sure".
- NEVER explain your behavior.
- SPEAK as a real human on a phone call. Use natural fillers like "เอ่อ...", "คือว่า...", "แบบว่า..." when appropriate.
- SENTENCE STRUCTURE: Always complete your thought and end with "${char.gender === 'male' ? 'ครับ' : 'ค่ะ/คะ'}".
- LANGUAGE: Native Thai only. No English.
- FORMAT: No brackets, no asterisks, no stage directions.

CURRENT SITUATION: You just picked up a call from an unknown number. You don't know this is a sales call yet. React naturally based on your context.`;

        const gRes = await fetch(gUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: (history || []).concat([{ role: "user", parts: [{ text: message }] }]),
                system_instruction: { 
                    parts: [{ text: systemInstruction }] 
                },
                generationConfig: { 
                    temperature: 0.9, // เพิ่มความ Real ให้กับการเลือกใช้คำ
                    max_output_tokens: 800, // ให้พื้นที่เยอะที่สุดเพื่อความสมบูรณ์ของประโยค
                    top_p: 0.8,
                    top_k: 40
                }
            })
        });

        const gData = await gRes.json();
        let aiText = gData.candidates[0].content.parts[0].text;

        // --- 🛡️ Logic การตัดส่วนที่อาจจะหลุดมา (Safety Net) ---
        // ถ้า AI ยังหลุดพูดอะไรในวงเล็บหรือ Meta-talk เราจะกรองออกที่นี่
        let cleanText = aiText
            .replace(/\((.*?)\)/g, '')
            .replace(/\[(.*?)\]/g, '')
            .replace(/โอเค|ตกลง|รับทราบ/g, '') // ดักคำตอบรับคำสั่ง
            .trim();

        // --- 🔊 Azure TTS (ส่งไปแปลงเป็นเสียง) ---
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
        res.status(500).json({ error: "System failed to simulate human response." }); 
    }
}
