export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, code, image, style, motion, customPrompt, engine } = req.body;

  // 1. Activation Code Verification
  if (action === 'verify_code') {
    const validMasterCode = process.env.PRO_UNLOCK_CODE || 'TOONPRO50';
    if (code === validMasterCode) {
      return res.status(200).json({ valid: true, creditsAdded: 50 });
    }
    return res.status(200).json({ valid: false });
  }

  // 2. Multi-Key Fallback Validation
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Missing GEMINI_API_KEY in Vercel Environment Variables. Verify that all 3 environments (Production, Preview, Dev) are checked.'
    });
  }

  try {
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    // ENGINE A: FREE SEMANTIC OBJECT RIGGING (Gemini Flash Vision)
    if (engine !== 'veo_cloud') {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

      const systemPrompt = `You are an expert computer vision and 2D cartoon animation engine.
Analyze the image and locate the primary foreground object (e.g., bike, animal, mug, car, person).
Return strictly valid JSON with no markdown wrapping:
{
  "objectLabel": "name of detected object",
  "box_2d": [ymin, xmin, ymax, xmax], 
  "eyeAnchor": [y, x],
  "mouthAnchor": [y, x],
  "caption": "A hilarious 4-to-6 word cartoon catchphrase as if this object is alive and talking",
  "accentColor": "#hexColor"
}
Note: All coordinates (box_2d, eyeAnchor, mouthAnchor) MUST be integers normalized to a scale of 0 to 1000.`;

      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: systemPrompt },
              { inline_data: { mime_type: 'image/jpeg', data: base64Data } }
            ]
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2
          }
        })
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error?.message || 'Gemini Vision API error');
      }

      let aiMetadata = {
        objectLabel: 'Object',
        box_2d: [150, 150, 850, 850],
        eyeAnchor: [380, 500],
        mouthAnchor: [550, 500],
        caption: "Hey! Look at me moving!",
        accentColor: '#6366f1'
      };

      try {
        const parsed = JSON.parse(result.candidates[0].content.parts[0].text);
        aiMetadata = { ...aiMetadata, ...parsed };
      } catch (e) {
        console.warn('JSON parse fallback applied');
      }

      return res.status(200).json({
        mode: 'free_hybrid',
        aiMetadata
      });
    }

    // ENGINE B: CLOUD DIFFUSION VIDEO (Google Veo)
    const veoUrl = `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-lite-generate-001:predictLongRunning?key=${apiKey}`;
    const veoRes = await fetch(veoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{
          prompt: `Animate the foreground object in ${style} cartoon style. Make it talk and perform a ${motion} animation. ${customPrompt}`,
          image: { bytesBase64Encoded: base64Data, mimeType: 'image/jpeg' }
        }],
        parameters: { aspectRatio: '1:1', durationSeconds: 5 }
      })
    });

    const veoData = await veoRes.json();
    if (!veoRes.ok) throw new Error(veoData.error?.message || 'Veo generation requires billing.');

    return res.status(200).json({
      mode: 'veo_cloud',
      operationName: veoData.name,
      aiMetadata: { caption: 'Generated via Veo Cloud AI' }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
