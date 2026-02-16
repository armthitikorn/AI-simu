export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(200).send("Azure & Gemini Server Ready");

    const { message, history, gender, level = 1 } = req.body;

    try {
        // --- 1. ปรับสมองให้เป็น "ลูกค้าจริงๆ" ไม่ใช่บอทตรวจข้อสอบ ---
        const systemPrompt = `คุณคือ "คุณเปรมวดี" ผู้หญิงวัยทำงานที่กำลังยุ่งอยู่กับงาน และจู่ๆ ก็มีเบอร์แปลกโทรเข้ามา
        
**ลักษณะนิสัย:**
- คุณไม่รู้มาก่อนว่าจะถูกขายประกัน คุณจะเริ่มบทสนทนาด้วยความสงสัย หรือระแวง (เพราะมิจฉาชีพเยอะ)
- **ความเป็นธรรมชาติ:** ใช้คำพูดเหมือนคนคุยกันจริงๆ เช่น "เอ่อ... คือ", "จากที่ไหนนะคะ?", "เดี๋ยวนะคะ พอดีไม่สะดวก", "อ๋อ ค่ะ แล้วยังไงต่อคะ?"
- **การตรวจเช็ค (แบบเนียนๆ):** คุณจะไม่บอกว่า "คุณทำผิดกฎ" แต่คุณจะถามเพราะความระแวง เช่น:
    * ถ้าเขาไม่แนะนำตัว: "เดี๋ยวนะคะ นี่ใครสายคะ? โทรจากไหน?"
    * ถ้าเขาไม่บอกเลขใบอนุญาต: "เอ่อ... คุณมีเลขตัวแทนยืนยันไหมคะ คือช่วงนี้คนโทรมาแอบอ้างเยอะน่ะค่ะ"
    * ถ้าไม่ขออัดเสียง: "นี่มีการบันทึกเสียงไว้ด้วยหรือเปล่าคะ?"

**ระดับอารมณ์:**
- เลเวล 1: ใจดีแต่ระแวงนิดๆ ถ้าพนักงานพูดจาดี แจ้งข้อมูลครบ คุณจะเริ่มรับฟัง
- เลเวล 2: ขี้สงสัย ถามเยอะ เน้นความคุ้มครองสุขภาพ/เงินออม
- เลเวล 3: รำคาญและยุ่งมาก ปฏิเสธเก่ง ถ้าพนักงานไม่ "มืออาชีพจริง" คุณจะวางสายทันที

**ข้อห้าม:** ห้ามใส่เครื่องหมายดอกจัน (*) หรือสัญลักษณ์แปลกๆ ให้ตอบเป็นข้อความแชท/คำพูดปกติเท่านั้น`;

        // --- 2. เรียกใช้ Gemini 2.5 Flash ---
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
        const aiText = gData.candidates[0].content.parts[0].text;

        // ล้างตัวอักษรส่วนเกิน
        let cleanText = aiText.replace(/[*#\-_]/g, '').replace(/\s+/g, ' ').trim();

        // --- 3. เรียกใช้ Microsoft Azure Speech (เน้นความละมุน) ---
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
            // ปรับ rate เป็น 1.0 (ปกติ) แต่ใช้ pitch ทุ้มเพื่อให้ดูสุขุมและมีอำนาจ
            body: `<speak version='1.0' xml:lang='th-TH'>
                    <voice xml:lang='th-TH' name='${voiceName}'>
                        <prosody rate="1.0" pitch="-3%">
                            ${cleanText}
                        </prosody>
                    </voice>
                  </speak>`
        });

        const audioArrayBuffer = await azureResponse.arrayBuffer();
        const base64Audio = Buffer.from(audioArrayBuffer).toString('base64');

        res.status(200).json({ text: cleanText, audio: base64Audio });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
