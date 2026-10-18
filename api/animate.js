export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, code, image, style, motion, customPrompt, engine } = req.body;

  // 1. Verify Pro Activation Code (Server-Side Monetization Check)
  if (action === 'verify_code') {
    const validMasterCode = process.env.PRO_UNLOCK_CODE || 'TOONPRO50';
    if (code === validMasterCode) {
      return res.status(200).json({ valid: true, creditsAdded: 50 });
    }
    return res.status(200).json({ valid: false });
  }

  // 2. Validate API Key Presence
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Missing GEMINI_API_KEY in Vercel Environment Variables.'
    });
  }

  try {
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    // ENGINE A: FREE FOREVER MODE (Uses Free Tier Gemini 3.8 Flash Vision API)
    if (engine !== 'veo_cloud') {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

      const promptText = `Analyze the main foreground object in this image. The user wants to cartoonify it in "${style}" style with "${motion}" motion. User note: "${customPrompt || 'none'}". Return strictly valid JSON with two keys: "caption" (a witty, short 4-to-6 word cartoon speech bubble for this object) and "accentColor" (a vibrant hex color code matching the object).`;

      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: promptText },
              { inline_data: { mime_type: 'image/jpeg', data: base64Data } }
            ]
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 120
          }
        })
      });

      const result = await response.json();
      let aiMetadata = { caption: 'Toon Mode Activated!', accentColor: '#4f46e5' };

      if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
        aiMetadata = JSON.parse(result.candidates[0].content.parts[0].text);
      }

      return res.status(200).json({
        mode: 'free_hybrid',
        aiMetadata
      });
    }

    // ENGINE B: PAID/TRIAL CLOUD VIDEO MODE (Uses Google Veo 3.1 Lite API)
    const veoUrl = `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-lite-generate-001:predictLongRunning?key=${apiKey}`;
    const fullVideoPrompt = `Turn the foreground object into a ${style} cartoon animated character performing a ${motion} motion. ${customPrompt || ''} Smooth animation.`;

    const veoInitRes = await fetch(veoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{
          prompt: fullVideoPrompt,
          image: { bytesBase64Encoded: base64Data, mimeType: 'image/jpeg' }
        }],
        parameters: { aspectRatio: '1:1', durationSeconds: 5 }
      })
    });

    const veoInitData = await veoInitRes.json();
    if (!veoInitRes.ok) {
      throw new Error(veoInitData.error?.message || 'Veo API requires a billing-enabled Gemini API key.');
    }

    return res.status(200).json({
      mode: 'veo_cloud',
      operationName: veoInitData.name,
      aiMetadata: { caption: 'Generated via Veo 3.1 Lite', accentColor: '#10b981' }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
