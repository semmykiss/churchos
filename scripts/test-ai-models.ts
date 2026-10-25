import ZAI from 'z-ai-web-dev-sdk'

const models = [undefined, 'glm-5.3-flash', 'GLM-5.3-Flash', 'glm-4.5-flash']

const zai = await ZAI.create()
for (const model of models) {
  try {
    const t0 = Date.now()
    const completion = await zai.chat.completions.create({
      ...(model ? { model } : {}),
      messages: [
        { role: 'assistant', content: 'You are a helpful assistant. Reply in max 10 words.' },
        { role: 'user', content: 'Say hello and name yourself.' },
      ] as any,
      thinking: { type: 'disabled' },
    } as any)
    const content = completion.choices?.[0]?.message?.content
    const served = completion.model ?? '(unknown)'
    console.log(`OK model=${model ?? '(default)'} served=${served} ms=${Date.now() - t0} reply=${JSON.stringify(content?.slice(0, 120))}`)
  } catch (e: any) {
    console.log(`FAIL model=${model ?? '(default)'}: ${String(e?.message ?? e).slice(0, 200)}`)
  }
}
