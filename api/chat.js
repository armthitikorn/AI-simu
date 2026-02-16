export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send("Azure & Gemini Server Ready");

    // รับข้อมูลจากหน้าบ้าน (ส่ง level มาเพื่อเลือกความยาก 1, 2, หรือ 3)
    const { message, history, gender, level = 1 } = req.body;

    try {
        // --- 1. ตั้งค่าระดับความยาก (System Instruction) ---
        let difficultyContext = "";
        if (level === 1) {
            difficultyContext = "[ระดับ: ลูกค้าใจดี] สุภาพ คุยง่าย สนใจประกันออมเงิน/ลดหย่อนภาษี ถามเรื่องผลประโยชน์ทั่วไป";
        } else if (level === 2) {
            difficultyContext = "[ระดับ: ลูกค้าช่างเลือก] รอบคอบ ถามละเอียดเรื่องสุขภาพและประกันสะสมทรัพย์ เปรียบเทียบผลตอบแทนเก่ง";
        } else {
            difficultyContext = "[ระดับ: ลูกค้าสายแข็ง] ยุ่งมาก ขี้รำคาญ ปฏิเสธเก่ง มีอคติกับประกัน ต้องใช้ศิลปะการจูงใจสูง";
        }

        const systemPrompt = `คุณคือ "คุณเปรมวดี" ลูกค้าที่จะมาช่วยฝึกทักษะการขายประกันทางโทรศัพท์
        
**กฎเหล็ก คปภ. (ต้องตรวจ):**
1. ในช่วงแรก พนักงานต้องทำ 3 ข้อนี้ให้ครบ: (1) แนะนำชื่อ-บริษัท (2) แจ้งเลขที่ใบอนุญาต (3) ขออนุญาตบันทึกเสียง
2. หากทำไม่ครบ คุณต้องทักท้วงและไม่ยอมฟังข้อเสนอเด็ดขาด เช่น "คุณชื่ออะไรนะคะ?", "มีใบอนุญาตไหม?"
3. เมื่อทำครบแล้ว คุณจึงจะเข้าสู่บทบาทลูกค้าตามระดับความยาก

**บทบาทปัจจุบันของคุณ:**
${difficultyContext}

**เป้าหมาย:** จะตกลงซื้อก็ต่อเมื่อพนักงานนำเสนอได้ถูกต้อง ตามกฎ คปภ. และตอบคำถามได้ตรงจุด`;

        // --- 2. เรียกใช้ Gemini 2.5 Flash (สมอง) ---
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: (history || []).concat([{ role: "user", parts: [{ text: message }] }]),
                system_instruction: { parts: [{ text: systemPrompt }] }
            })
        });

        const gData = await geminiResponse.json();
        if (!gData.candidates) throw new Error("Gemini Error: " + JSON.stringify(gData));
        const aiText = gData.candidates[0].content.parts[0].text;

        // --- 3. เรียกใช้ Microsoft Azure Speech (เสียงไทยแท้) ---
        const azureRegion = process.env.AZURE_REGION || 'southeastasia';
        const azureKey = process.env.AZURE_API_KEY;
        const voiceName = (gender === 'male') ? 'th-TH-NiwatNeural' : 'th-TH-PremwadeeNeural';

        const azureResponse = await fetch(`https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': azureKey,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3'
            },
            body: `<speak version='1.0' xml:lang='th-TH'><voice xml:lang='th-TH' name='${voiceName}'>${aiText}</voice></speak>`
        });

        if (!azureResponse.ok) throw new Error("Azure TTS Error");

        const audioArrayBuffer = await azureResponse.arrayBuffer();
        const base64Audio = Buffer.from(audioArrayBuffer).toString('base64');

        // ส่งผลลัพธ์กลับไปที่หน้าจอ
        res.status(200).json({ text: aiText, audio: base64Audio });

    } catch (error) {
        console.error("Error:", error.message);
        res.status(500).json({ error: error.message });
    }
}
